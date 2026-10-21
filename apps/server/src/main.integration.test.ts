import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { healthResponseSchema } from '@sextou/contract';
import { openDatabase, type Database } from '@sextou/data';
import { openTasks, type Tasks } from '@sextou/tasks';
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
import { startServer } from './server';

// main reads the home directory from node:os, which in a worker thread
// ignores a stubbed HOME. Each test points it at its own temporary directory,
// so none reaches the developer's data directory.
const home = vi.hoisted(() => ({ dir: '' }));
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
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

// The real package, watched so each test can reach the database main opened.
vi.mock('@sextou/data', async (importOriginal) => {
  const data = await importOriginal<typeof import('@sextou/data')>();
  return { openDatabase: vi.fn(data.openDatabase) };
});

// The real package too, so each test can reach the task graph main opened.
vi.mock('@sextou/tasks', async (importOriginal) => {
  const tasks = await importOriginal<typeof import('@sextou/tasks')>();
  return { openTasks: vi.fn(tasks.openTasks) };
});

let dir: string;
let on: MockInstance<typeof process.on>;
let off: MockInstance<typeof process.off>;
let exit: MockInstance<typeof process.exit>;

function args(...rest: string[]) {
  vi.spyOn(process, 'argv', 'get').mockReturnValue([
    'node',
    'main.ts',
    ...rest,
  ]);
}

function openedDatabase(): Promise<Database> {
  return vi.mocked(openDatabase).mock.results[0].value;
}

function openedTasks(): Promise<Tasks> {
  return vi.mocked(openTasks).mock.results[0].value;
}

// A closed task graph rejects any operation.
async function tasksOpen() {
  try {
    await (await openedTasks()).listReady({ assignees: ['dev'], limit: 1 });
    return true;
  } catch {
    return false;
  }
}

async function databaseAnswers() {
  return (await openedDatabase()).ping();
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
  vi.stubEnv('XDG_DATA_HOME', undefined);
  vi.stubEnv('LOCALAPPDATA', undefined);
  vi.stubEnv('SEXTOU_SERVER_HOST', undefined);
  vi.stubEnv('SEXTOU_SERVER_PORT', undefined);
  vi.stubEnv('SEXTOU_SERVER_DATABASE', undefined);
  vi.stubEnv('SEXTOU_SERVER_DATA_DIR', undefined);
  on = vi.spyOn(process, 'on').mockImplementation(() => process);
  off = vi.spyOn(process, 'off').mockImplementation(() => process);
  exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  for (const result of vi.mocked(openDatabase).mock.settledResults) {
    if (result.type === 'fulfilled') await result.value.close();
  }
  for (const result of vi.mocked(openTasks).mock.settledResults) {
    if (result.type === 'fulfilled') await result.value.close();
  }
  process.exitCode = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

test('starts the server from the arguments and prints where it listens', async () => {
  args('--port', '0', '--data-dir', dir, '--database', ':memory:');

  await import('./main');

  expect(startServer).toHaveBeenCalledOnce();
  const [app, config] = vi.mocked(startServer).mock.calls[0];
  expect(config).toEqual({
    host: '127.0.0.1',
    port: 0,
    dataDir: dir,
    database: ':memory:',
    tasks: join(dir, 'default.tasks.db'),
  });
  // The app reports the package's version, an uptime counted from the start
  // just now, and the database it opened.
  const response = await (app as Hono).request('/health');
  expect(response.status).toBe(200);
  expect(healthResponseSchema.parse(await response.json())).toEqual({
    version: packageJson.version,
    uptimeSeconds: 0,
    database: 'up',
  });
  expect(console.log).toHaveBeenCalledWith(
    'listening on http://127.0.0.1:54321',
  );
});

test('brackets an IPv6 address in the listening URL', async () => {
  vi.mocked(startServer).mockResolvedValueOnce({
    host: '::1',
    port: 54321,
    close: () => Promise.resolve(),
  });
  args('--database', ':memory:');

  await import('./main');

  expect(console.log).toHaveBeenCalledWith('listening on http://[::1]:54321');
});

// The default path is the Linux one; CI runs Linux.
test.runIf(process.platform === 'linux')(
  'creates the database in the data directory when no path is given',
  async () => {
    args();

    await import('./main');

    expect(existsSync(join(dir, '.local/share/sextou/sextou.db'))).toBe(true);
    const [app] = vi.mocked(startServer).mock.calls[0];
    const response = await (app as Hono).request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ database: 'up' });
  },
);

test('opens the database, then the task graph, then listens', async () => {
  args('--database', ':memory:');

  await import('./main');

  expect(vi.mocked(openDatabase).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(openTasks).mock.invocationCallOrder[0],
  );
  expect(vi.mocked(openTasks).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(startServer).mock.invocationCallOrder[0],
  );
});

// Covers AE7. The default path is the Linux one; CI runs Linux.
test.runIf(process.platform === 'linux')(
  'starts with no git on the PATH and keeps only its two databases',
  async () => {
    vi.stubEnv('PATH', join(dir, 'empty'));
    const dataDir = join(dir, 'data');
    args('--data-dir', dataDir);

    await import('./main');

    const [app] = vi.mocked(startServer).mock.calls[0];
    const response = await (app as Hono).request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ database: 'up' });
    const files = readdirSync(dataDir);
    expect(files).toEqual(
      expect.arrayContaining(['sextou.db', 'default.tasks.db']),
    );
    for (const file of files) {
      expect(file).toMatch(/^(sextou|default\.tasks)\.db(-wal)?$/);
    }
  },
);

test('when the task graph cannot be opened, exits with 1 naming the path and the reason, closes the database, and never listens', async () => {
  const tasks = join(dir, 'default.tasks.db');
  writeFileSync(tasks, 'not a database, just some text that is long enough');
  args('--data-dir', dir, '--database', ':memory:');

  await import('./main');

  expect(startServer).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
  expect(console.error).toHaveBeenCalledWith(
    `Could not open the task graph at ${tasks}: failed to open database ${tasks}: File is not a database`,
  );
  expect(await databaseAnswers()).toBe(false);
  expect(on).not.toHaveBeenCalled();
});

test('when the database cannot be opened, exits with 1 and names the path and the reason, without listening', async () => {
  writeFileSync(join(dir, 'file'), '');
  const path = join(dir, 'file', 'sextou.db');
  args('--database', path);

  await import('./main');

  expect(startServer).not.toHaveBeenCalled();
  expect(openTasks).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
  // The reason is the file system's: the folder is a file.
  expect(console.error).toHaveBeenCalledWith(
    `Could not open the database at ${path}: EEXIST: file already exists, mkdir '${join(dir, 'file')}'`,
  );
  expect(on).not.toHaveBeenCalled();
});

test('closes the task graph and the database and rethrows when listening fails', async () => {
  const error = Object.assign(new Error('listen EADDRINUSE'), {
    code: 'EADDRINUSE',
  });
  vi.mocked(startServer).mockRejectedValueOnce(error);
  args('--database', ':memory:');

  await expect(import('./main')).rejects.toBe(error);

  expect(await tasksOpen()).toBe(false);
  expect(await databaseAnswers()).toBe(false);
  expect(on).not.toHaveBeenCalled();
});

test.each(['SIGTERM', 'SIGINT'])(
  'on %s, closes the server, then the task graph, then the database, then exits with 0',
  async (signal) => {
    let openAtServerClose: boolean[] | undefined;
    let databaseAnsweredAtTasksClose: boolean | undefined;
    vi.mocked(startServer).mockResolvedValueOnce({
      host: '127.0.0.1',
      port: 54321,
      close: async () => {
        openAtServerClose = [await tasksOpen(), await databaseAnswers()];
      },
    });
    const closed: string[] = [];
    let closedAtExit: string[] | undefined;
    exit.mockImplementation(((code: number) => {
      closedAtExit = [...closed];
      expect(code).toBe(0);
    }) as never);
    args('--database', ':memory:');
    await import('./main');
    const tasks = await openedTasks();
    const database = await openedDatabase();
    const closeTasks = tasks.close;
    const closeDatabase = database.close;
    vi.spyOn(tasks, 'close').mockImplementation(async () => {
      databaseAnsweredAtTasksClose = await database.ping();
      await closeTasks();
      closed.push('tasks');
    });
    vi.spyOn(database, 'close').mockImplementation(async () => {
      await closeDatabase();
      closed.push('database');
    });

    await handler(signal)();

    expect(closedAtExit).toEqual(['tasks', 'database']);
    expect(await tasksOpen()).toBe(false);
    expect(await databaseAnswers()).toBe(false);
    expect(openAtServerClose).toEqual([true, true]);
    expect(databaseAnsweredAtTasksClose).toBe(true);
    expect(exit).toHaveBeenCalledWith(0);
  },
);

test.each(['SIGTERM', 'SIGINT'])(
  'on %s, stops listening for both signals, so shutdown runs once',
  async (signal) => {
    args('--database', ':memory:');
    await import('./main');
    const shutdown = handler(signal);

    await shutdown();

    expect(handler('SIGINT')).toBe(shutdown);
    expect(handler('SIGTERM')).toBe(shutdown);
    expect(off).toHaveBeenCalledWith('SIGINT', shutdown);
    expect(off).toHaveBeenCalledWith('SIGTERM', shutdown);
  },
);
