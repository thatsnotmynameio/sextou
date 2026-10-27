import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  inject,
  test,
  vi,
  type MockInstance,
} from 'vitest';
import {
  answer,
  archive,
  plaintext,
  serve,
  sha,
  type Served,
} from '../archive';
import { goTask } from '../go-task';

// The server tests/server.ts started for this Vitest instance, which serves
// every run of this file: Stryker runs it once per mutant. Each run's tasks go
// to assignees of its own, so a task an earlier run left reaches no runner.
const serverUrl = inject('serverUrl');
const run = randomUUID();

function assigned(assignee: string) {
  return `${assignee}-${run}`;
}

// The real logger, writing to memory instead of stdout, so each test reads
// the records main wrote. Each logger gets a stream of its own, as pino-pretty
// pipes into it and ends it with the logger.
const output = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock(import('@sextou/logger'), async (importOriginal) => {
  const logger = await importOriginal();
  const { Writable } = await import('node:stream');
  return {
    ...logger,
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
let github: Served;
let on: MockInstance<typeof process.on>;
let off: MockInstance<typeof process.off>;
let exit: MockInstance<typeof process.exit>;

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

// The Taskfile in a folder of sextou's repository, at the commit the tarball
// on localhost holds.
function uses(folder: string) {
  return `thatsnotmynameio/sextou/${folder}/Taskfile.yml@${sha}`;
}

/**
 * Creates a task on the server for the runner to claim.
 * @param assignee who may take it: the runner a test starts serves it
 * @param options.context the task's context
 * @param options.withUses whether the task names one of the tarball's Taskfiles
 * @param options.folder the folder of the Taskfile it names
 * @returns the created task's id
 */
async function createTask(
  assignee: string,
  {
    context,
    withUses = true,
    folder = 'tasks/hello-world',
  }: {
    context?: Record<string, unknown>;
    withUses?: boolean;
    folder?: string;
  } = {},
) {
  return (await call('tasks.create', {
    title: 'Say hi',
    kind: 'task',
    priority: 2,
    assignee: assigned(assignee),
    createdBy: 'me',
    context,
    uses: withUses ? uses(folder) : undefined,
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
  vi.stubEnv('SEXTOU_RUNNER_GITHUB_URL', github.url);
  vi.stubEnv('SEXTOU_RUNNER_NAME', `runner-${assignee}`);
  vi.stubEnv('SEXTOU_RUNNER_ASSIGNEES', assigned(assignee));
  vi.stubEnv('SEXTOU_RUNNER_POLL_MS', '50');
  vi.stubEnv('SEXTOU_RUNNER_LOG_LEVEL', 'debug');
  await import('../../src/main');
}

// Each task names a Taskfile in sextou's repository on GitHub. The runner
// downloads it from a server on localhost instead, whose tarball has four:
// tasks/hello-world writes a line, then the context it got; tasks/released
// writes the line, then runs until the file its context's `release` names
// exists, for at most 5 seconds, so a test holds the run until it saw what
// happens while it runs; tasks/long-run runs for 2 seconds, for a cancel to
// stop; and tasks/create-tasks writes the context it got as its tasks file.
// Stryker runs each test again for every mutant it covers, so each second a
// run lasts costs minutes.
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-runner-'));
  github = await serve(
    answer(
      archive({
        'tasks/hello-world/Taskfile.yml': plaintext([
          'echo "sextou task"',
          'echo {{.CONTEXT | q}}',
        ]),
        'tasks/released/Taskfile.yml': plaintext([
          'echo "sextou task"',
          'for i in $(seq 100); do [ -e {{(fromJson .CONTEXT).release | q}} ] && exit 0; sleep 0.05; done; exit 1',
        ]),
        'tasks/long-run/Taskfile.yml': plaintext(['sleep 2']),
        'tasks/create-tasks/Taskfile.yml': plaintext([
          'echo {{.CONTEXT | q}} > {{.TASKS_FILE | q}}',
        ]),
      }),
    ),
  );
});

afterAll(async () => {
  await github.close();
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

goTask(
  'main logs that it started, with its name, assignees and server',
  async () => {
    await startRunner('started');

    expect(await logged('started')).toMatchObject({
      level: 30,
      name: 'runner-started',
      assignees: [assigned('started')],
      serverUrl,
    });
  },
);

goTask(
  'main completes a claimed task as succeeded once its Taskfile ran',
  async () => {
    const release = join(dir, assigned('release'));
    const task = await createTask('succeeds', {
      context: { release },
      folder: 'tasks/released',
    });
    await startRunner('succeeds');

    expect(await logged('claimed')).toMatchObject({
      taskId: task.id,
      attempt: 1,
    });
    // go-task writes each command to stderr before it runs it.
    expect(await logged('output', { stream: 'stdout' })).toMatchObject({
      taskId: task.id,
      line: 'sextou task',
    });
    expect(github.paths.at(-1)).toMatch(
      /^\/thatsnotmynameio\/sextou\/archive\/[0-9a-f]{40}\.tar\.gz$/,
    );
    expect(await logged('heartbeat')).toMatchObject({ taskId: task.id });
    writeFileSync(release, '');
    expect(await logged('completed')).toMatchObject({
      taskId: task.id,
      outcome: 'succeeded',
    });
    expect(
      await call('runners.claim', {
        claimId: assigned('after'),
        runner: 'other',
        assignees: [assigned('succeeds')],
      }),
    ).toEqual({ task: null });
  },
);

goTask(
  'main completes a task that names no uses as failed, with the reason, then runs the next one',
  async () => {
    const failing = await createTask('no-uses', { withUses: false });
    const next = await createTask('no-uses');
    const downloads = github.paths.length;
    await startRunner('no-uses');

    expect(await logged('completed', { taskId: failing.id })).toMatchObject({
      outcome: 'failed',
      reason: 'the task names nothing to run: it has no uses',
    });
    expect(await logged('completed', { taskId: next.id })).toMatchObject({
      outcome: 'succeeded',
    });
    expect(github.paths).toHaveLength(downloads + 1);
  },
);

goTask(
  'main hands the Taskfile the context the task was created with',
  async () => {
    const context = { repo: 'org/app', ref: 'main' };
    const task = await createTask('context', { context });
    await startRunner('context');

    expect(
      await logged('output', { taskId: task.id, stream: 'stdout' }),
    ).toMatchObject({ line: 'sextou task' });
    expect(
      await logged('output', {
        taskId: task.id,
        line: JSON.stringify(context),
      }),
    ).toMatchObject({ stream: 'stdout' });
  },
);

/**
 * Runs main on a task whose Taskfile writes a tasks file of two tasks, second
 * waiting for first, for an assignee no runner serves, so the test claims them.
 * @param name the runner's assignee, and the created tasks' with a suffix
 * @returns the task that ran and the created tasks' assignee
 */
async function runCreatingTasks(name: string) {
  const assignee = assigned(`${name}-created`);
  const tasks = [
    { key: 'first', title: 'First', kind: 'task', priority: 2, assignee },
    {
      key: 'second',
      title: 'Second',
      kind: 'task',
      priority: 1,
      assignee,
      blockedBy: ['first'],
    },
  ];
  const task = await createTask(name, {
    folder: 'tasks/create-tasks',
    context: { tasks },
  });
  await startRunner(name);
  return { task, assignee };
}

goTask('main sends the tasks file its Taskfile wrote', async () => {
  const { task, assignee } = await runCreatingTasks('sends-tasks');

  // The server recorded the run as it was sent: it took the file.
  expect(await logged('completed', { taskId: task.id })).toMatchObject({
    outcome: 'succeeded',
    reason: null,
  });
  const first = await logged('task created', {
    taskId: task.id,
    key: 'first',
  });
  // second waits for first, so a claim gets first, whatever its priority.
  expect(
    await call('runners.claim', {
      claimId: randomUUID(),
      runner: 'other',
      assignees: [assignee],
    }),
  ).toMatchObject({ task: { id: first.id } });
});

goTask(
  'main logs each task the server created from the tasks file its Taskfile wrote',
  async () => {
    const { task } = await runCreatingTasks('logs-created');

    const first = await logged('task created', {
      taskId: task.id,
      key: 'first',
    });
    const second = await logged('task created', {
      taskId: task.id,
      key: 'second',
    });
    expect(second.id).not.toBe(first.id);
  },
);

goTask(
  'main completes a task as cancelled once someone asks to cancel it while its Taskfile runs',
  async () => {
    const task = await createTask('cancels', { folder: 'tasks/long-run' });
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

goTask('main stops on SIGINT and SIGTERM, once, and exits with 0', async () => {
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

goTask.each([
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

test('main exits with 1 when SEXTOU_RUNNER_TASK_BIN is not go-task, without calling the server', async () => {
  const missing = join(dir, 'no-task');
  vi.stubEnv('SEXTOU_RUNNER_TASK_BIN', missing);

  await import('../../src/main');

  await vi.waitFor(() => expect(process.exitCode).toBe(1));
  expect(records()).toEqual([
    expect.objectContaining({
      level: 50,
      taskBin: missing,
      reason: `spawn ${missing} ENOENT`,
      msg: 'SEXTOU_RUNNER_TASK_BIN is not go-task',
    }),
  ]);
  expect(on).not.toHaveBeenCalled();
});

goTask(
  'main exits with 1 when SEXTOU_RUNNER_TAR_BIN does not run, without calling the server',
  async () => {
    const missing = join(dir, 'no-tar');
    vi.stubEnv('SEXTOU_RUNNER_TAR_BIN', missing);

    await import('../../src/main');

    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(records()).toEqual([
      expect.objectContaining({
        level: 50,
        tarBin: missing,
        reason: `spawn ${missing} ENOENT`,
        msg: 'SEXTOU_RUNNER_TAR_BIN does not run',
      }),
    ]);
    expect(on).not.toHaveBeenCalled();
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
