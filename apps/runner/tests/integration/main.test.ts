import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
  type MockInstance,
} from 'vitest';
import { goTask } from '../go-task';

// The server runs as its own process, from its sources, with its own tsx:
// the runner imports nothing from it but its router's type. Its folder is
// found through the workspace's link, which Stryker's sandbox, a copy of this
// package in another folder, reaches too.
const serverDir = dirname(
  dirname(createRequire(import.meta.url).resolve('@sextou/server/router')),
);

// The real logger, writing to memory instead of stdout, so each test reads
// the records main wrote. Each logger gets a stream of its own, as pino-pretty
// pipes into it and ends it with the logger.
const output = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock(import('../../src/logger'), async (importOriginal) => {
  const logger = await importOriginal();
  const { Writable } = await import('node:stream');
  return {
    createLogger: (options) =>
      logger.createLogger(
        options,
        new Writable({
          write: (chunk, _encoding, done) => {
            output.lines.push(String(chunk));
            done();
          },
        }),
      ),
  };
});

type LogRecord = Record<string, unknown>;

function records(): LogRecord[] {
  return output.lines.map((line) => JSON.parse(line) as LogRecord);
}

// Resolves with the first record main wrote whose msg is `msg`, and whose
// fields are those of `fields`.
function logged(msg: string, fields: LogRecord = {}): Promise<LogRecord> {
  return vi.waitFor(
    () => {
      const record = records().find(
        (candidate) =>
          candidate.msg === msg &&
          Object.entries(fields).every(
            ([key, value]) => candidate[key] === value,
          ),
      );
      if (!record) {
        throw new Error(`No ${msg} record yet`);
      }
      return record;
    },
    { timeout: 10_000, interval: 20 },
  );
}

let dir: string;
let server: ChildProcess;
let serverUrl: string;
let on: MockInstance<typeof process.on>;
let off: MockInstance<typeof process.off>;
let exit: MockInstance<typeof process.exit>;

// Starts the server on a port the system picks, with a short lease, and
// resolves with its URL, from the record it logs once listening.
async function startServer(): Promise<string> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH,
      SEXTOU_SERVER_PORT: '0',
      SEXTOU_SERVER_DATA_DIR: dir,
      SEXTOU_SERVER_LEASE_MS: '600',
      SEXTOU_SERVER_LEASE_SWEEP_MS: '100',
      SEXTOU_SERVER_LOG_LEVEL: 'info',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  // The spawned process keeps its stdio's types; the variable the cleanup
  // reads doesn't.
  server = child;
  for await (const line of createInterface({ input: child.stdout })) {
    const record = parseRecord(line);
    if (record?.msg === 'listening' && typeof record.url === 'string') {
      return record.url;
    }
  }
  throw new Error('The server exited before listening');
}

function parseRecord(line: string): LogRecord | undefined {
  try {
    return JSON.parse(line) as LogRecord;
  } catch {
    return undefined;
  }
}

// Calls a mutation on the server over HTTP and resolves with its data.
async function call(procedure: string, input: unknown): Promise<unknown> {
  const response = await fetch(`${serverUrl}/trpc/${procedure}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as { result: { data: unknown } };
  return body.result.data;
}

async function createTask(assignee: string) {
  return (await call('tasks.create', {
    title: 'Say hi',
    kind: 'task',
    priority: 2,
    assignee,
    createdBy: 'me',
  })) as { id: string };
}

// The handler main registered for a signal.
function handler(signal: string) {
  const registered = on.mock.calls.find(([event]) => event === signal);
  return registered?.[1] as () => Promise<void>;
}

// Runs main against the server, for `assignee` alone.
async function startRunner(assignee: string) {
  vi.stubEnv('SEXTOU_RUNNER_SERVER_URL', serverUrl);
  vi.stubEnv('SEXTOU_RUNNER_NAME', `runner-${assignee}`);
  vi.stubEnv('SEXTOU_RUNNER_ASSIGNEES', assignee);
  vi.stubEnv('SEXTOU_RUNNER_POLL_MS', '50');
  vi.stubEnv('SEXTOU_RUNNER_LOG_LEVEL', 'debug');
  await import('../../src/main');
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-runner-'));
  serverUrl = await startServer();
}, 30_000);

afterAll(async () => {
  if (server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
  }
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.resetModules();
  output.lines = [];
  // No runner variable from the shell reaches main.
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('SEXTOU_RUNNER_')) {
      vi.stubEnv(name, undefined);
    }
  }
  on = vi.spyOn(process, 'on').mockImplementation(() => process);
  off = vi.spyOn(process, 'off').mockImplementation(() => process);
  exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});

afterEach(async () => {
  // Stops the runner a test started, so none outlives its test.
  await handler('SIGTERM')?.();
  process.exitCode = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test('main logs that it started, with its name, assignees and server', async () => {
  await startRunner('started');

  expect(await logged('started')).toMatchObject({
    level: 30,
    name: 'runner-started',
    assignees: ['started'],
    serverUrl,
  });
});

// The server hands every task its stub Taskfile, which writes a line and
// runs for 2 seconds.
goTask(
  'main completes a claimed task as succeeded once its Taskfile ran',
  async () => {
    const task = await createTask('succeeds');
    await startRunner('succeeds');

    expect(await logged('claimed')).toMatchObject({
      taskId: task.id,
      attempt: 1,
    });
    // go-task writes each command to stderr before it runs it.
    expect(await logged('output', { stream: 'stdout' })).toMatchObject({
      taskId: task.id,
      line: 'sextou stub',
    });
    expect(await logged('completed')).toMatchObject({
      taskId: task.id,
      outcome: 'succeeded',
    });
    expect(messages()).toContain('heartbeat');
    expect(
      await call('runners.claim', {
        claimId: 'after',
        runner: 'other',
        assignees: ['succeeds'],
      }),
    ).toEqual({ task: null });
  },
);

goTask(
  'main completes a task as cancelled once someone asks to cancel it while its Taskfile runs',
  async () => {
    const task = await createTask('cancels');
    await startRunner('cancels');
    await logged('claimed');

    expect(
      await call('tasks.cancel', { taskId: task.id, actor: 'me' }),
    ).toEqual({
      status: 'running',
    });

    expect(await logged('completed')).toMatchObject({
      taskId: task.id,
      outcome: 'cancelled',
    });
  },
);

test('main stops on SIGINT and SIGTERM, once, and exits with 0', async () => {
  await startRunner('stops');
  await logged('started');

  await handler('SIGINT')();

  expect(off.mock.calls).toEqual([
    ['SIGINT', handler('SIGINT')],
    ['SIGTERM', handler('SIGINT')],
  ]);
  expect(handler('SIGTERM')).toBe(handler('SIGINT'));
  expect(exit).toHaveBeenCalledWith(0);
  expect(messages().at(-1)).toBe('stopped');
});

test.each([
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const)(
  'main exits at once with the code of a second %s',
  async (signal, code) => {
    await startRunner('exits');
    await logged('started');
    void handler('SIGINT')();

    const second = on.mock.calls.filter(
      ([event]) => event === signal,
    )[1]?.[1] as (signal: NodeJS.Signals) => void;
    second(signal);

    expect(exit).toHaveBeenCalledWith(code);
  },
);

test('main exits with 1 on an invalid variable, without calling the server', async () => {
  vi.stubEnv('SEXTOU_RUNNER_POLL_MS', '0');

  await import('../../src/main');

  expect(process.exitCode).toBe(1);
  expect(records()).toEqual([
    expect.objectContaining({
      level: 50,
      msg: 'Invalid SEXTOU_RUNNER_POLL_MS: "0" (expected a whole number of milliseconds from 1 to 2147483647)',
    }),
  ]);
  expect(on).not.toHaveBeenCalled();
});

function messages() {
  return records().map((record) => record.msg);
}
