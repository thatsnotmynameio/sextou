import {
  afterEach,
  beforeEach,
  expect,
  test,
  vi,
  type MockInstance,
} from 'vitest';

// The real logger, writing to memory instead of stdout, so each test reads
// the records main wrote.
const output = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock(import('../../src/logger'), async (importOriginal) => {
  const logger = await importOriginal();
  const { memory } = await import('../memory');
  return {
    createLogger: (options) => {
      const sink = memory();
      output.lines = sink.lines;
      return logger.createLogger(options, sink.destination);
    },
  };
});

function messages() {
  return output.lines.map((line) => JSON.parse(line).msg as unknown);
}

const variables = [
  'SEXTOU_RUNNER_SERVER_URL',
  'SEXTOU_RUNNER_POLL_INTERVAL_MS',
  'SEXTOU_RUNNER_REQUEST_TIMEOUT_MS',
  'SEXTOU_RUNNER_DEV',
  'SEXTOU_RUNNER_LOG_LEVEL',
];

let on: MockInstance<typeof process.on>;
let off: MockInstance<typeof process.off>;
let exit: MockInstance<typeof process.exit>;

beforeEach(() => {
  vi.resetModules();
  output.lines = [];
  for (const name of variables) {
    vi.stubEnv(name, undefined);
  }
  // Signal handlers are captured, not registered, and an exit wouldn't end the
  // test run.
  on = vi.spyOn(process, 'on').mockReturnValue(process);
  off = vi.spyOn(process, 'off').mockReturnValue(process);
  exit = vi.spyOn(process, 'exit').mockReturnValue(undefined as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  process.exitCode = undefined;
});

// The handler main registered for a signal.
function handler(signal: string) {
  const call = on.mock.calls.find(([event]) => event === signal);
  return call?.[1] as () => void;
}

// Runs main, which keeps polling until a signal stops it.
function run() {
  return import('../../src/main');
}

// Runs main with an invalid variable, which returns without polling.
async function runInvalid() {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  vi.stubEnv('SEXTOU_RUNNER_POLL_INTERVAL_MS', '0');
  await run();
  return fetch;
}

test('main logs an invalid variable as an error naming it', async () => {
  await runInvalid();

  expect(output.lines.map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining({
      level: 50,
      msg: expect.stringContaining('Invalid SEXTOU_RUNNER_POLL_INTERVAL_MS'),
    }),
  ]);
});

test('main sets exit code 1 on an invalid variable', async () => {
  await runInvalid();

  expect(process.exitCode).toBe(1);
});

test('main never asks the server when a variable is invalid', async () => {
  const fetch = await runInvalid();

  expect(fetch).not.toHaveBeenCalled();
  expect(on).not.toHaveBeenCalled();
});

// Runs main against a server that answers no task, until its first answer,
// then stops it with SIGTERM.
async function runUntilFirstAnswer() {
  const fetch = vi.fn(async (_input: string | URL) =>
    Response.json({ result: { data: { task: null } } }),
  );
  vi.stubGlobal('fetch', fetch);
  vi.stubEnv('SEXTOU_RUNNER_SERVER_URL', 'http://server.test:4310');
  vi.stubEnv('SEXTOU_RUNNER_POLL_INTERVAL_MS', '10');
  const running = run();
  await vi.waitFor(() => expect(messages()).toContain('no task'));
  handler('SIGTERM')();
  await running;
  return fetch;
}

test('main first logs where it polls, with its interval', async () => {
  await runUntilFirstAnswer();

  expect(output.lines.map((line) => JSON.parse(line))[0]).toMatchObject({
    level: 30,
    msg: 'polling',
    url: 'http://server.test:4310',
    intervalMs: 10,
  });
});

test('main asks runner.next at the configured server URL', async () => {
  const fetch = await runUntilFirstAnswer();

  expect(String(fetch.mock.calls[0]?.[0])).toBe(
    'http://server.test:4310/trpc/runner.next',
  );
});

test('main logs stopped on SIGTERM', async () => {
  await runUntilFirstAnswer();

  expect(messages().at(-1)).toBe('stopped');
});

test('main returns on SIGTERM with no error code, without forcing an exit', async () => {
  await runUntilFirstAnswer();

  expect(exit).not.toHaveBeenCalled();
  expect(process.exitCode).toBeUndefined();
});

test('main on SIGINT aborts the request in flight without logging it as failed', async () => {
  const fetch = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(init.signal?.reason),
        );
      }),
  );
  vi.stubGlobal('fetch', fetch);

  const running = run();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  handler('SIGINT')();
  await running;

  expect(messages()).toEqual(['polling', 'stopped']);
  expect(exit).not.toHaveBeenCalled();
  expect(process.exitCode).toBeUndefined();
});

test('main removes both signal handlers on the first signal', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ result: { data: { task: null } } })),
  );

  const running = run();
  await vi.waitFor(() => expect(handler('SIGTERM')).toBeTypeOf('function'));
  const stop = handler('SIGTERM');
  stop();
  await running;

  expect(handler('SIGINT')).toBe(stop);
  expect(off).toHaveBeenCalledWith('SIGINT', stop);
  expect(off).toHaveBeenCalledWith('SIGTERM', stop);
});
