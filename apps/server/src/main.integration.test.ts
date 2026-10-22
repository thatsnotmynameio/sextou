import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import {
  afterEach,
  beforeEach,
  expect,
  test,
  vi,
  type MockInstance,
} from 'vitest';
import packageJson from '../package.json';
import { createDatabase, type Database } from './database';
import { startServer } from './server';

// main reads the home directory from node:os, which in a worker thread
// ignores a stubbed HOME. Each test points it at its own temporary directory,
// so none reaches the developer's data directory.
const home = vi.hoisted(() => ({ dir: '' }));
vi.mock(import('node:os'), async (importOriginal) => ({
  ...(await importOriginal()),
  homedir: () => home.dir,
}));

vi.mock('./server', () => ({
  startServer: vi.fn(() =>
    Promise.resolve({
      host: '127.0.0.1',
      port: 54321,
      close: () => Promise.resolve(),
    }),
  ),
}));

// The real module, watched so each test can reach the database main created.
vi.mock(import('./database'), async (importOriginal) => {
  const database = await importOriginal();
  return { createDatabase: vi.fn(database.createDatabase) };
});

// The real logger, writing to memory instead of stdout, so each test reads
// the records main wrote.
const output = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock(import('./logger'), async (importOriginal) => {
  const logger = await importOriginal();
  return {
    createLogger: (level) =>
      logger.createLogger(level, {
        write: (line) => {
          output.lines.push(line);
        },
      }),
  };
});

function records(): unknown[] {
  return output.lines.map((line) => JSON.parse(line));
}

const variables = [
  'SEXTOU_SERVER_HOST',
  'SEXTOU_SERVER_PORT',
  'SEXTOU_SERVER_DATA_DIR',
  'SEXTOU_SERVER_DATABASE',
  'SEXTOU_SERVER_WEB_ORIGIN',
  'SEXTOU_SERVER_DATABASE_TIMEOUT_MS',
  'SEXTOU_SERVER_DEV',
  'SEXTOU_SERVER_LOG_LEVEL',
  'XDG_DATA_HOME',
  'LOCALAPPDATA',
];

let dir: string;
let on: MockInstance<typeof process.on>;
let off: MockInstance<typeof process.off>;
let exit: MockInstance<typeof process.exit>;

function createdDatabase(): Database {
  return vi.mocked(createDatabase).mock.results[0].value;
}

// The app main handed to startServer.
function servedApp(): Hono {
  return vi.mocked(startServer).mock.calls[0][0] as Hono;
}

async function health() {
  const response = await servedApp().request('/trpc/health.check');
  return (await response.json()).result.data;
}

// The handler main registered for a signal.
function handler(signal: string) {
  const call = on.mock.calls.find(([event]) => event === signal);
  return call?.[1] as () => Promise<void>;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dir = mkdtempSync(join(tmpdir(), 'sextou-main-'));
  home.dir = dir;
  output.lines = [];
  for (const name of variables) {
    vi.stubEnv(name, undefined);
  }
  on = vi.spyOn(process, 'on').mockImplementation(() => process);
  off = vi.spyOn(process, 'off').mockImplementation(() => process);
  exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});

afterEach(async () => {
  for (const result of vi.mocked(createDatabase).mock.results) {
    if (result.type === 'return') {
      await result.value.close();
    }
  }
  process.exitCode = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

test('starts the server from the environment and logs where it listens', async () => {
  vi.stubEnv('SEXTOU_SERVER_PORT', '0');
  vi.stubEnv('SEXTOU_SERVER_DATABASE', ':memory:');

  await import('./main');

  expect(startServer).toHaveBeenCalledOnce();
  expect(vi.mocked(startServer).mock.calls[0][1]).toMatchObject({
    host: '127.0.0.1',
    port: 0,
  });
  expect(await health()).toEqual({
    version: packageJson.version,
    database: 'up',
  });
  expect(records()).toEqual([
    expect.objectContaining({
      level: 30,
      msg: 'listening',
      url: 'http://127.0.0.1:54321',
    }),
  ]);
});

test('brackets an IPv6 address in the listening URL', async () => {
  vi.mocked(startServer).mockResolvedValueOnce({
    host: '::1',
    port: 54321,
    close: () => Promise.resolve(),
  });
  vi.stubEnv('SEXTOU_SERVER_DATABASE', ':memory:');

  await import('./main');

  expect(records()).toEqual([
    expect.objectContaining({ msg: 'listening', url: 'http://[::1]:54321' }),
  ]);
});

// A process that starts the server reads the URL from this record.
test('logs no listening record at level warn', async () => {
  vi.stubEnv('SEXTOU_SERVER_DATABASE', ':memory:');
  vi.stubEnv('SEXTOU_SERVER_LOG_LEVEL', 'warn');

  await import('./main');

  expect(startServer).toHaveBeenCalledOnce();
  expect(records()).toEqual([]);
});

// Covers AE1. The default path is the Linux one; CI runs Linux.
test.runIf(process.platform === 'linux')(
  'creates the data directory and the database in it when no path is given',
  async () => {
    await import('./main');

    expect(await health()).toMatchObject({ database: 'up' });
    expect(existsSync(join(dir, '.local/share/sextou/sextou.db'))).toBe(true);
  },
);

// Covers AE2.
test('listens and reports the database down when its folder is a file', async () => {
  writeFileSync(join(dir, 'file'), '');
  vi.stubEnv('SEXTOU_SERVER_DATABASE', join(dir, 'file', 'sextou.db'));

  await import('./main');

  expect(startServer).toHaveBeenCalledOnce();
  expect(await health()).toEqual({
    version: packageJson.version,
    database: 'down',
  });
  expect(records()).toEqual([
    expect.objectContaining({
      level: 50,
      msg: "Could not create the database's folder",
      folder: join(dir, 'file'),
      err: expect.objectContaining({
        message: `EEXIST: file already exists, mkdir '${join(dir, 'file')}'`,
      }),
    }),
    expect.objectContaining({ msg: 'listening' }),
  ]);
});

test('creates no folder for an in-memory database', async () => {
  vi.stubEnv('SEXTOU_SERVER_DATA_DIR', join(dir, 'data'));
  vi.stubEnv('SEXTOU_SERVER_DATABASE', ':memory:');

  await import('./main');

  expect(existsSync(join(dir, 'data'))).toBe(false);
});

test('exits with 1, naming the variable, without listening when a variable is invalid', async () => {
  vi.stubEnv('SEXTOU_SERVER_PORT', 'abc');

  await import('./main');

  expect(process.exitCode).toBe(1);
  expect(records()).toEqual([
    expect.objectContaining({
      level: 50,
      msg: 'Invalid SEXTOU_SERVER_PORT: "abc" (expected a port from 0 to 65535)',
    }),
  ]);
  expect(createDatabase).not.toHaveBeenCalled();
  expect(startServer).not.toHaveBeenCalled();
  expect(on).not.toHaveBeenCalled();
});

// The configured level isn't read when another variable is invalid.
test('logs an invalid variable even at level silent', async () => {
  vi.stubEnv('SEXTOU_SERVER_PORT', 'abc');
  vi.stubEnv('SEXTOU_SERVER_LOG_LEVEL', 'silent');

  await import('./main');

  expect(records()).toEqual([
    expect.objectContaining({
      level: 50,
      msg: 'Invalid SEXTOU_SERVER_PORT: "abc" (expected a port from 0 to 65535)',
    }),
  ]);
});

test('exits with 1, naming the variable, without listening when the log level is invalid', async () => {
  vi.stubEnv('SEXTOU_SERVER_LOG_LEVEL', 'verbose');

  await import('./main');

  expect(process.exitCode).toBe(1);
  expect(records()).toEqual([
    expect.objectContaining({
      level: 50,
      msg: expect.stringMatching(/^Invalid SEXTOU_SERVER_LOG_LEVEL: "verbose"/),
    }),
  ]);
  expect(startServer).not.toHaveBeenCalled();
});

test('lets SEXTOU_SERVER_WEB_ORIGIN read the answers', async () => {
  vi.stubEnv('SEXTOU_SERVER_DATABASE', ':memory:');
  vi.stubEnv('SEXTOU_SERVER_WEB_ORIGIN', 'https://app.example');

  await import('./main');

  const response = await servedApp().request('/trpc/health.check', {
    headers: { origin: 'https://app.example' },
  });
  expect(response.headers.get('access-control-allow-origin')).toBe(
    'https://app.example',
  );
});

test.each([
  ['true', true],
  ['false', false],
])(
  'with SEXTOU_SERVER_DEV=%s, error responses carry the stack: %s',
  async (value, stack) => {
    vi.stubEnv('SEXTOU_SERVER_DATABASE', ':memory:');
    vi.stubEnv('SEXTOU_SERVER_DEV', value);

    await import('./main');

    const response = await servedApp().request('/trpc/nothing');
    const { error } = await response.json();
    expect('stack' in error.data).toBe(stack);
  },
);

test('gives the database the configured timeout', async () => {
  vi.stubEnv('SEXTOU_SERVER_DATABASE', ':memory:');
  vi.stubEnv('SEXTOU_SERVER_DATABASE_TIMEOUT_MS', '1234');

  await import('./main');

  expect(createDatabase).toHaveBeenCalledWith(':memory:', 1234);
});

test('closes the database and rethrows when listening fails', async () => {
  const error = Object.assign(new Error('listen EADDRINUSE'), {
    code: 'EADDRINUSE',
  });
  vi.mocked(startServer).mockRejectedValueOnce(error);
  vi.stubEnv('SEXTOU_SERVER_DATABASE', ':memory:');

  await expect(import('./main')).rejects.toBe(error);

  expect(await createdDatabase().ping()).toBe(false);
  expect(on).not.toHaveBeenCalled();
});

test.each(['SIGTERM', 'SIGINT'])(
  'on %s, stops listening, then closes the database, then exits with 0',
  async (signal) => {
    const closed: string[] = [];
    vi.mocked(startServer).mockResolvedValueOnce({
      host: '127.0.0.1',
      port: 54321,
      close: async () => {
        closed.push('server');
      },
    });
    let closedAtExit: string[] | undefined;
    exit.mockImplementation((() => {
      closedAtExit = [...closed];
    }) as never);
    vi.stubEnv('SEXTOU_SERVER_DATABASE', ':memory:');
    await import('./main');
    const database = createdDatabase();
    const close = database.close;
    vi.spyOn(database, 'close').mockImplementation(async () => {
      await close();
      closed.push('database');
    });

    await handler(signal)();

    expect(closedAtExit).toEqual(['server', 'database']);
    expect(await database.ping()).toBe(false);
    expect(exit).toHaveBeenCalledWith(0);
  },
);

test.each(['SIGTERM', 'SIGINT'])(
  'on %s, stops listening for both signals, so shutdown runs once',
  async (signal) => {
    vi.stubEnv('SEXTOU_SERVER_DATABASE', ':memory:');
    await import('./main');
    const shutdown = handler(signal);

    await shutdown();

    expect(handler('SIGINT')).toBe(shutdown);
    expect(handler('SIGTERM')).toBe(shutdown);
    expect(off).toHaveBeenCalledWith('SIGINT', shutdown);
    expect(off).toHaveBeenCalledWith('SIGTERM', shutdown);
  },
);
