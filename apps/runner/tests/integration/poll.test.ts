import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createClient } from '../../src/client';
import { createLogger } from '../../src/logger';
import { poll } from '../../src/poll';
import { memory } from '../memory';

// The server runs as its own process, from its sources, with its own tsx:
// the runner imports nothing from it but its router's type. Its folder is
// found through the package, not a relative path, which would point
// elsewhere from inside Stryker's sandbox.
const serverDir = dirname(
  dirname(createRequire(import.meta.url).resolve('@sextou/server/router')),
);

let dir: string;
let server: ChildProcess | undefined;

// Starts the server on a port the system picks, with its databases in
// memory, and resolves with its URL, from the record it logs once listening.
async function startServer(): Promise<string> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH,
      SEXTOU_SERVER_PORT: '0',
      SEXTOU_SERVER_DATABASE: ':memory:',
      SEXTOU_SERVER_TASKS_DB: ':memory:',
      SEXTOU_SERVER_DATA_DIR: dir,
      // At warn and above, the server doesn't log where it listens.
      SEXTOU_SERVER_LOG_LEVEL: 'info',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  server = child;
  for await (const line of createInterface({ input: child.stdout })) {
    const record = parseRecord(line);
    if (record?.msg === 'listening' && typeof record.url === 'string') {
      return record.url;
    }
  }
  throw new Error('The server exited before listening');
}

function parseRecord(line: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

// A URL on localhost that nothing listens on: a port the system picked,
// closed again.
async function closedUrl(): Promise<string> {
  const listener = createServer();
  await new Promise<void>((resolve) =>
    listener.listen(0, '127.0.0.1', resolve),
  );
  const { port } = listener.address() as AddressInfo;
  await new Promise((resolve) => listener.close(resolve));
  return `http://127.0.0.1:${port}`;
}

// Runs the loop against `serverUrl` until `enough` holds for its records.
async function pollUntil(
  serverUrl: string,
  enough: (records: Record<string, unknown>[]) => void,
) {
  const output = memory();
  const controller = new AbortController();
  const running = poll({
    client: createClient(serverUrl, 10_000),
    intervalMs: 50,
    logger: createLogger({ level: 'info', pretty: false }, output.destination),
    signal: controller.signal,
  });
  await vi.waitFor(() => enough(output.records()), { timeout: 10_000 });
  controller.abort();
  await running;
  return output.records();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-runner-'));
});

afterEach(async () => {
  // A process a signal ended has a signalCode and no exitCode.
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
  }
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

// Covers AE1.
test('poll gets no task from the real server, request after request', async () => {
  const records = await pollUntil(await startServer(), (records) =>
    expect(records.length).toBeGreaterThanOrEqual(2),
  );

  expect(records.slice(0, 2)).toEqual([
    expect.objectContaining({ level: 30, msg: 'no task' }),
    expect.objectContaining({ level: 30, msg: 'no task' }),
  ]);
});

// Covers AE2.
test('poll logs every attempt against a port nothing listens on as no answer', async () => {
  const records = await pollUntil(await closedUrl(), (records) =>
    expect(records.length).toBeGreaterThanOrEqual(2),
  );

  expect(records.slice(0, 2)).toEqual([
    expect.objectContaining({
      level: 40,
      msg: 'request failed',
      kind: 'no-answer',
    }),
    expect.objectContaining({
      level: 40,
      msg: 'request failed',
      kind: 'no-answer',
    }),
  ]);
});
