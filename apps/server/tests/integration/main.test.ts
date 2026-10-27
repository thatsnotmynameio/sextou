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
import packageJson from '../../package.json';
import { createDatabase, type Database } from '../../src/database';
import { startServer } from '../../src/server';
import type { NewTask } from '../../src/tasks';
import { createTasksService, type TasksService } from '../../src/tasks-service';

// main reads the home directory from node:os, which in a worker thread
// ignores a stubbed HOME. Each test points it at its own temporary directory,
// so none reaches the developer's data directory.
const home = vi.hoisted(() => ({ dir: '' }));
vi.mock(import('node:os'), async (importOriginal) => ({
  ...(await importOriginal()),
  homedir: () => home.dir,
}));

vi.mock('../../src/server', () => ({
  startServer: vi.fn(() =>
    Promise.resolve({
      host: '127.0.0.1',
      port: 54321,
      close: () => Promise.resolve(),
    }),
  ),
}));

// The real module, watched so each test can reach the database main created.
vi.mock(import('../../src/database'), async (importOriginal) => {
  const database = await importOriginal();
  return { createDatabase: vi.fn(database.createDatabase) };
});

// The real logger, writing to memory instead of stdout, so each test reads
// the records main wrote.
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

function records(): unknown[] {
  return output.lines.map((line) => JSON.parse(line));
}

// The real service, watched so each test can reach the one main created and
// see when its start settled.
vi.mock(import('../../src/tasks-service'), async (importOriginal) => {
  const service = await importOriginal();
  return {
    createTasksService: vi.fn(
      (...args: Parameters<typeof service.createTasksService>) => {
        const tasks = service.createTasksService(...args);
        vi.spyOn(tasks, 'start');
        return tasks;
      },
    ),
  };
});

const variables = [
  'SEXTOU_SERVER_HOST',
  'SEXTOU_SERVER_PORT',
  'SEXTOU_SERVER_DATA_DIR',
  'SEXTOU_SERVER_DATABASE',
  'SEXTOU_SERVER_TASKS_DB',
  'SEXTOU_SERVER_WEB_ORIGIN',
  'SEXTOU_SERVER_DATABASE_TIMEOUT_MS',
  'SEXTOU_SERVER_LEASE_MS',
  'SEXTOU_SERVER_MAX_ATTEMPTS',
  'SEXTOU_SERVER_LEASE_SWEEP_MS',
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

// The tasks service from main's nth run, counting from 0.
function tasksService(run = 0): TasksService {
  return vi.mocked(createTasksService).mock.results[run].value;
}

const newTask: NewTask = {
  title: 'Write the tests',
  kind: 'task',
  priority: 2,
  assignee: { name: 'dev' },
  createdBy: { name: 'planner' },
};

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
  // A test that looks at the tasks database's file sets its own path.
  vi.stubEnv('SEXTOU_SERVER_TASKS_DB', ':memory:');
  // From source the default is the checkout's apps/server/storage, which no
  // test may write into.
  vi.stubEnv('SEXTOU_SERVER_DATA_DIR', join(dir, 'data'));
  // No sweep fires unless a test asks for one, so none outlives its test
  // and writes into the next one's records.
  vi.stubEnv('SEXTOU_SERVER_LEASE_SWEEP_MS', '2147483647');
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
  for (const result of vi.mocked(createTasksService).mock.results) {
    if (result.type === 'return') {
      await result.value.stop();
    }
  }
  process.exitCode = undefined;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

test('starts the server from the environment and logs where it listens', async () => {
  vi.stubEnv('SEXTOU_SERVER_PORT', '0');
  vi.stubEnv('SEXTOU_SERVER_DATABASE', ':memory:');

  await import('../../src/main');

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

  await import('../../src/main');

  expect(records()).toEqual([
    expect.objectContaining({ msg: 'listening', url: 'http://[::1]:54321' }),
  ]);
});

// A process that starts the server reads the URL from this record.
test('logs no listening record at level warn', async () => {
  vi.stubEnv('SEXTOU_SERVER_DATABASE', ':memory:');
  vi.stubEnv('SEXTOU_SERVER_LOG_LEVEL', 'warn');

  await import('../../src/main');

  expect(startServer).toHaveBeenCalledOnce();
  expect(records()).toEqual([]);
});

test('logs readable lines, not JSON, with SEXTOU_SERVER_DEV=true', async () => {
  vi.stubEnv('SEXTOU_SERVER_DATABASE', ':memory:');
  vi.stubEnv('SEXTOU_SERVER_DEV', 'true');

  await import('../../src/main');

  await vi.waitFor(() =>
    expect(output.lines.join('')).toContain('http://127.0.0.1:54321'),
  );
  expect(output.lines.join('')).toContain('listening');
  expect(() => records()).toThrow(SyntaxError);
});

// Covers AE1.
test('creates the data directory and the database in it when no database path is given', async () => {
  await import('../../src/main');

  expect(await health()).toMatchObject({ database: 'up' });
  expect(existsSync(join(dir, 'data', 'sextou.db'))).toBe(true);
});

// The production build defines __TASKS_MIGRATIONS__, here as the package's own
// folder seen from src/, and then the default is the user's data directory,
// under the mocked home. The default path is the Linux one; CI runs Linux.
test.runIf(process.platform === 'linux')(
  'creates the database in the user data directory in the production build when no path is given',
  async () => {
    vi.stubGlobal(
      '__TASKS_MIGRATIONS__',
      join('..', '..', '..', 'packages', 'tasks', 'drizzle'),
    );
    vi.stubEnv('SEXTOU_SERVER_DATA_DIR', undefined);

    await import('../../src/main');

    expect(await health()).toMatchObject({ database: 'up' });
    expect(existsSync(join(dir, '.local/share/sextou/sextou.db'))).toBe(true);
  },
);

test('opens the tasks database in the data directory when no path is given', async () => {
  vi.stubEnv('SEXTOU_SERVER_TASKS_DB', undefined);

  await import('../../src/main');

  expect(createTasksService).toHaveBeenCalledWith(
    join(dir, 'data', 'tasks.db'),
    expect.objectContaining({
      logger: expect.objectContaining({ error: expect.any(Function) }),
    }),
  );
  expect(existsSync(join(dir, 'data', 'tasks.db'))).toBe(true);
});

// From source, the default is apps/server/storage. The service opens
// ':memory:' instead of the path main hands it, so the checkout's own
// databases stay untouched.
test('opens the tasks database in apps/server/storage from source when no path is given', async () => {
  vi.stubEnv('SEXTOU_SERVER_DATA_DIR', undefined);
  vi.stubEnv('SEXTOU_SERVER_DATABASE', ':memory:');
  vi.stubEnv('SEXTOU_SERVER_TASKS_DB', undefined);
  const { createTasksService: real } = await vi.importActual<{
    createTasksService: typeof createTasksService;
  }>('../../src/tasks-service');
  vi.mocked(createTasksService).mockImplementationOnce((_path, options) =>
    real(':memory:', options),
  );

  await import('../../src/main');

  expect(createTasksService).toHaveBeenCalledWith(
    join(import.meta.dirname, '..', '..', 'storage', 'tasks.db'),
    expect.objectContaining({
      logger: expect.objectContaining({ error: expect.any(Function) }),
    }),
  );
});

test('starts the tasks service at SEXTOU_SERVER_TASKS_DB before listening', async () => {
  const path = join(dir, 'tasks', 'tasks.db');
  vi.stubEnv('SEXTOU_SERVER_TASKS_DB', path);
  let startedAtListen: string | undefined;
  vi.mocked(startServer).mockImplementationOnce(async () => {
    startedAtListen = vi.mocked(tasksService().start).mock.settledResults[0]
      ?.type;
    return { host: '127.0.0.1', port: 54321, close: () => Promise.resolve() };
  });

  await import('../../src/main');

  expect(createTasksService).toHaveBeenCalledWith(path, {
    logger: expect.objectContaining({ error: expect.any(Function) }),
    leaseMs: 30000,
    maxAttempts: 1,
    maxCreatedTasks: 50,
    maxTaskDepth: 20,
    timeoutMs: 20000,
  });
  expect(startedAtListen).toBe('fulfilled');
  expect(await tasksService().create(newTask)).toMatchObject({ ok: true });
});

// A tasks database file that is not a database, which the service can't open.
function brokenTasksDb() {
  const path = join(dir, 'tasks.db');
  writeFileSync(path, 'not a database, just some text that is long enough');
  vi.stubEnv('SEXTOU_SERVER_TASKS_DB', path);
  return path;
}

// The production build defines __TASKS_MIGRATIONS__ as the folder beside
// server.mjs; from source, main.ts resolves it against src/, where there is
// none, so the open fails on that exact folder.
test('hands the tasks service the migrations folder the build defined', async () => {
  vi.stubGlobal('__TASKS_MIGRATIONS__', 'bundled-migrations');

  await import('../../src/main');

  expect(records()).toContainEqual(
    expect.objectContaining({
      msg: 'Could not open the tasks database',
      err: expect.objectContaining({
        message: expect.stringContaining(
          join(import.meta.dirname, '..', '..', 'src', 'bundled-migrations'),
        ),
      }),
    }),
  );
});

test('listens when the tasks database does not open, logging why', async () => {
  const path = brokenTasksDb();

  await import('../../src/main');

  expect(startServer).toHaveBeenCalledOnce();
  expect(records()).toEqual([
    expect.objectContaining({
      level: 50,
      msg: 'Could not open the tasks database',
      path,
      err: expect.objectContaining({
        message: expect.stringContaining('File is not a database'),
      }),
    }),
    expect.objectContaining({ msg: 'listening' }),
  ]);
});

test('the tasks service rejects its calls when the tasks database does not open', async () => {
  brokenTasksDb();

  await import('../../src/main');

  await expect(tasksService().create(newTask)).rejects.toThrow(
    'File is not a database',
  );
});

test('sweeps no lease when the tasks database does not open', async () => {
  brokenTasksDb();
  vi.stubEnv('SEXTOU_SERVER_LEASE_MS', '20');
  vi.stubEnv('SEXTOU_SERVER_LEASE_SWEEP_MS', '5');
  await import('../../src/main');
  const expire = vi.spyOn(tasksService(), 'expire');

  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(expire).not.toHaveBeenCalled();
});

test('a restart once the tasks database is fixed gives a service that works', async () => {
  const path = brokenTasksDb();
  await import('../../src/main');
  rmSync(path);
  rmSync(`${path}-wal`, { force: true });
  vi.resetModules();

  await import('../../src/main');

  expect(await tasksService(1).create(newTask)).toMatchObject({ ok: true });
});

// Covers AE2.
test('listens and reports the database down when its folder is a file', async () => {
  writeFileSync(join(dir, 'file'), '');
  vi.stubEnv('SEXTOU_SERVER_DATABASE', join(dir, 'file', 'sextou.db'));

  await import('../../src/main');

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
  vi.stubEnv('SEXTOU_SERVER_DATABASE', ':memory:');

  await import('../../src/main');

  expect(existsSync(join(dir, 'data'))).toBe(false);
});

test('exits with 1, naming the variable, without listening when a variable is invalid', async () => {
  vi.stubEnv('SEXTOU_SERVER_PORT', 'abc');

  await import('../../src/main');

  expect(process.exitCode).toBe(1);
  expect(records()).toEqual([
    expect.objectContaining({
      level: 50,
      msg: 'Invalid SEXTOU_SERVER_PORT: "abc" (expected a port from 0 to 65535)',
    }),
  ]);
  expect(createTasksService).not.toHaveBeenCalled();
  expect(createDatabase).not.toHaveBeenCalled();
  expect(startServer).not.toHaveBeenCalled();
  expect(on).not.toHaveBeenCalled();
});

// The configured level isn't read when another variable is invalid.
test('logs an invalid variable even at level silent', async () => {
  vi.stubEnv('SEXTOU_SERVER_PORT', 'abc');
  vi.stubEnv('SEXTOU_SERVER_LOG_LEVEL', 'silent');

  await import('../../src/main');

  expect(records()).toEqual([
    expect.objectContaining({
      level: 50,
      msg: 'Invalid SEXTOU_SERVER_PORT: "abc" (expected a port from 0 to 65535)',
    }),
  ]);
});

test('exits with 1, naming the variable, without listening when the log level is invalid', async () => {
  vi.stubEnv('SEXTOU_SERVER_LOG_LEVEL', 'verbose');

  await import('../../src/main');

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

  await import('../../src/main');

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

    await import('../../src/main');

    const response = await servedApp().request('/trpc/nothing');
    const { error } = await response.json();
    expect('stack' in error.data).toBe(stack);
  },
);

test('hands the tasks service the lease length, the attempts and the timeout from the environment', async () => {
  vi.stubEnv('SEXTOU_SERVER_LEASE_MS', '60000');
  vi.stubEnv('SEXTOU_SERVER_MAX_ATTEMPTS', '3');
  vi.stubEnv('SEXTOU_SERVER_TASKS_TIMEOUT_MS', '1500');

  await import('../../src/main');

  expect(createTasksService).toHaveBeenCalledWith(
    ':memory:',
    expect.objectContaining({
      leaseMs: 60000,
      maxAttempts: 3,
      timeoutMs: 1500,
    }),
  );
});

// A tRPC mutation over the app main served.
async function mutate(path: string, input: unknown) {
  const response = await servedApp().request(`/trpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return ((await response.json()) as { result: { data: unknown } }).result.data;
}

test('serves the tasks and the runners procedures over the tasks service', async () => {
  await import('../../src/main');

  const created = (await mutate('tasks.create', {
    title: 'Write the tests',
    kind: 'task',
    priority: 2,
    assignee: 'dev',
    uses: 'thatsnotmynameio/sextou/packages/workflows/hello-world/Taskfile.yml@87dfc7f4f839d6e334ab1a1cdf6494c62499d9ff',
    createdBy: 'planner',
  })) as { id: string };
  const claimed = await mutate('runners.claim', {
    claimId: 'claim-1',
    runner: 'runner-1',
    assignees: ['dev'],
  });

  expect(claimed).toMatchObject({
    task: {
      id: created.id,
      uses: {
        repo: 'thatsnotmynameio/sextou',
        sha: '87dfc7f4f839d6e334ab1a1cdf6494c62499d9ff',
        taskfile: 'packages/workflows/hello-world/Taskfile.yml',
      },
    },
    execution: { attempt: 1, leaseMs: 30000 },
  });
});

// The sweep starts ending leases a whole lease after the server starts, and
// takes a sweep a third of a lease late as a pause: the lease is long enough
// that a timer's jitter never counts as one.
test('ends expired leases every SEXTOU_SERVER_LEASE_SWEEP_MS, logging each task it failed', async () => {
  vi.stubEnv('SEXTOU_SERVER_LEASE_MS', '300');
  vi.stubEnv('SEXTOU_SERVER_LEASE_SWEEP_MS', '20');
  await import('../../src/main');
  const tasks = tasksService();
  const created = await tasks.create(newTask);
  await tasks.claim({
    claimId: 'claim-1',
    runner: { name: 'runner-1' },
    assignees: [{ name: 'dev' }],
  });

  await vi.waitFor(() => {
    expect(records()).toContainEqual(
      expect.objectContaining({
        level: 40,
        msg: 'Failed a task whose lease expired',
        taskId: created.ok && created.task.id,
        attempt: 1,
        status: 'failed',
      }),
    );
  });
  await handler('SIGTERM')();
});

test('stops sweeping on shutdown', async () => {
  vi.stubEnv('SEXTOU_SERVER_LEASE_MS', '150');
  vi.stubEnv('SEXTOU_SERVER_LEASE_SWEEP_MS', '5');
  await import('../../src/main');
  const tasks = tasksService();
  const expire = vi.spyOn(tasks, 'expire');
  await vi.waitFor(() => {
    expect(expire).toHaveBeenCalled();
  });

  await handler('SIGTERM')();
  const calls = expire.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(expire).toHaveBeenCalledTimes(calls);
});

test('gives the database the configured timeout', async () => {
  vi.stubEnv('SEXTOU_SERVER_DATABASE', ':memory:');
  vi.stubEnv('SEXTOU_SERVER_DATABASE_TIMEOUT_MS', '1234');

  await import('../../src/main');

  expect(createDatabase).toHaveBeenCalledWith(':memory:', 1234);
});

test('stops the tasks service, closes the database and rethrows when listening fails', async () => {
  const error = Object.assign(new Error('listen EADDRINUSE'), {
    code: 'EADDRINUSE',
  });
  vi.mocked(startServer).mockRejectedValueOnce(error);
  vi.stubEnv('SEXTOU_SERVER_DATABASE', ':memory:');

  await expect(import('../../src/main')).rejects.toBe(error);

  await expect(tasksService().create(newTask)).rejects.toThrow();
  expect(await createdDatabase().ping()).toBe(false);
  expect(on).not.toHaveBeenCalled();
});

test.each(['SIGTERM', 'SIGINT'])(
  'on %s, stops listening, then the tasks service, then closes the database, then exits with 0',
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
    await import('../../src/main');
    const tasks = tasksService();
    const stop = tasks.stop;
    vi.spyOn(tasks, 'stop').mockImplementation(async () => {
      await stop();
      closed.push('tasks');
    });
    const database = createdDatabase();
    const close = database.close;
    vi.spyOn(database, 'close').mockImplementation(async () => {
      await close();
      closed.push('database');
    });

    await handler(signal)();

    expect(closedAtExit).toEqual(['server', 'tasks', 'database']);
    await expect(tasks.create(newTask)).rejects.toThrow();
    expect(await database.ping()).toBe(false);
    expect(exit).toHaveBeenCalledWith(0);
  },
);

test.each(['SIGTERM', 'SIGINT'])(
  'on %s, stops listening for both signals, so shutdown runs once',
  async (signal) => {
    vi.stubEnv('SEXTOU_SERVER_DATABASE', ':memory:');
    await import('../../src/main');
    const shutdown = handler(signal);

    await shutdown();

    expect(handler('SIGINT')).toBe(shutdown);
    expect(handler('SIGTERM')).toBe(shutdown);
    expect(off).toHaveBeenCalledWith('SIGINT', shutdown);
    expect(off).toHaveBeenCalledWith('SIGTERM', shutdown);
  },
);
