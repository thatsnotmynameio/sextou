import { expect, test, vi } from 'vitest';
import { loadConfig, type PathContext } from '../../src/config';

const paths: PathContext = {
  platform: 'linux',
  homedir: () => '/home/ana',
  cwd: '/work',
};

function load(env: Record<string, string | undefined>) {
  return loadConfig(env, paths);
}

test('loadConfig uses every default when no variable is set', () => {
  expect(load({})).toEqual({
    host: '127.0.0.1',
    port: 4310,
    database: '/home/ana/.local/share/sextou/sextou.db',
    tasksDb: '/home/ana/.local/share/sextou/tasks.db',
    webOrigin: 'http://localhost:5173',
    databaseTimeoutMs: 20000,
    dev: false,
    logLevel: 'info',
  });
});

test('loadConfig takes every variable that is set', () => {
  expect(
    load({
      SEXTOU_SERVER_HOST: '0.0.0.0',
      SEXTOU_SERVER_PORT: '8080',
      SEXTOU_SERVER_DATABASE: '/a.db',
      SEXTOU_SERVER_TASKS_DB: '/t.db',
      SEXTOU_SERVER_WEB_ORIGIN: 'https://app.example',
      SEXTOU_SERVER_DATABASE_TIMEOUT_MS: '500',
      SEXTOU_SERVER_DEV: 'true',
      SEXTOU_SERVER_LOG_LEVEL: 'debug',
    }),
  ).toEqual({
    host: '0.0.0.0',
    port: 8080,
    database: '/a.db',
    tasksDb: '/t.db',
    webOrigin: 'https://app.example',
    databaseTimeoutMs: 500,
    dev: true,
    logLevel: 'debug',
  });
});

test('loadConfig accepts port 0, for a port the system picks', () => {
  expect(load({ SEXTOU_SERVER_PORT: '0' }).port).toBe(0);
});

test.each(['', 'abc', '0x50', '1e3', '-1', '65536'])(
  'loadConfig rejects port %j',
  (port) => {
    expect(() => load({ SEXTOU_SERVER_PORT: port })).toThrow(
      `Invalid SEXTOU_SERVER_PORT: ${JSON.stringify(port)}`,
    );
  },
);

// An empty host would bind every interface, not loopback.
test('loadConfig rejects an empty host', () => {
  expect(() => load({ SEXTOU_SERVER_HOST: '' })).toThrow(
    'Invalid SEXTOU_SERVER_HOST: ""',
  );
});

test('loadConfig puts the database in the data directory by default', () => {
  expect(load({ XDG_DATA_HOME: '/data' }).database).toBe(
    '/data/sextou/sextou.db',
  );
});

test('loadConfig puts the database and the tasks database in SEXTOU_SERVER_DATA_DIR', () => {
  expect(load({ SEXTOU_SERVER_DATA_DIR: '/d' })).toMatchObject({
    database: '/d/sextou.db',
    tasksDb: '/d/tasks.db',
  });
});

test('loadConfig keeps a configured database outside the data directory', () => {
  expect(
    load({ SEXTOU_SERVER_DATA_DIR: '/d', SEXTOU_SERVER_DATABASE: '/x.db' })
      .database,
  ).toBe('/x.db');
});

test('loadConfig resolves a relative data directory against the working directory', () => {
  expect(load({ SEXTOU_SERVER_DATA_DIR: 'data' }).database).toBe(
    '/work/data/sextou.db',
  );
});

test('loadConfig resolves a relative database path against the working directory', () => {
  expect(load({ SEXTOU_SERVER_DATABASE: 'data.db' }).database).toBe(
    '/work/data.db',
  );
});

test('loadConfig keeps :memory: as it is', () => {
  expect(load({ SEXTOU_SERVER_DATABASE: ':memory:' }).database).toBe(
    ':memory:',
  );
});

test('loadConfig resolves a relative tasks database path against the working directory', () => {
  expect(load({ SEXTOU_SERVER_TASKS_DB: 'tasks.db' }).tasksDb).toBe(
    '/work/tasks.db',
  );
});

test('loadConfig keeps a tasks database of :memory: as it is', () => {
  expect(load({ SEXTOU_SERVER_TASKS_DB: ':memory:' }).tasksDb).toBe(':memory:');
});

test('loadConfig does not read the home directory when both paths are given', () => {
  const config = loadConfig(
    { SEXTOU_SERVER_DATABASE: '/b.db', SEXTOU_SERVER_TASKS_DB: '/t.db' },
    {
      ...paths,
      homedir: () => {
        throw new Error('read the home directory');
      },
    },
  );
  expect(config).toMatchObject({ database: '/b.db', tasksDb: '/t.db' });
});

test.each([
  [{}, '/home/ana/.local/share/sextou/sextou.db'],
  [{ SEXTOU_SERVER_DATABASE: '/b.db' }, '/b.db'],
])('loadConfig with %j reads the home directory once', (env, database) => {
  const homedir = vi.fn(() => '/home/ana');
  const config = loadConfig(env, { ...paths, homedir });
  expect(config).toMatchObject({
    database,
    tasksDb: '/home/ana/.local/share/sextou/tasks.db',
  });
  expect(homedir).toHaveBeenCalledOnce();
});

test('loadConfig rejects an empty data directory', () => {
  expect(() => load({ SEXTOU_SERVER_DATA_DIR: '' })).toThrow(
    'Invalid SEXTOU_SERVER_DATA_DIR: ""',
  );
});

// SQLite opens an empty path as a temporary database, deleted on close.
test('loadConfig rejects an empty database path', () => {
  expect(() => load({ SEXTOU_SERVER_DATABASE: '' })).toThrow(
    'Invalid SEXTOU_SERVER_DATABASE: ""',
  );
});

test('loadConfig rejects an empty tasks database path', () => {
  expect(() => load({ SEXTOU_SERVER_TASKS_DB: '' })).toThrow(
    'Invalid SEXTOU_SERVER_TASKS_DB: "" (expected a file path or :memory:)',
  );
});

// The browser sends the origin with no path and no trailing slash, and CORS
// compares it as a string.
test('loadConfig keeps only the origin of SEXTOU_SERVER_WEB_ORIGIN', () => {
  expect(
    load({ SEXTOU_SERVER_WEB_ORIGIN: 'https://app.example:8443/inbox/' })
      .webOrigin,
  ).toBe('https://app.example:8443');
});

test.each(['', 'localhost:5173', 'file:///index.html', 'ftp://app.example'])(
  'loadConfig rejects web origin %j',
  (origin) => {
    expect(() => load({ SEXTOU_SERVER_WEB_ORIGIN: origin })).toThrow(
      `Invalid SEXTOU_SERVER_WEB_ORIGIN: ${JSON.stringify(origin)}`,
    );
  },
);

// The longest delay setTimeout takes; a longer one fires after 1 ms.
test('loadConfig accepts a database timeout of 2147483647', () => {
  expect(
    load({ SEXTOU_SERVER_DATABASE_TIMEOUT_MS: '2147483647' }).databaseTimeoutMs,
  ).toBe(2147483647);
});

test.each(['', '0', 'abc', '1.5', '-1', '1e3', '2147483648'])(
  'loadConfig rejects database timeout %j',
  (timeout) => {
    expect(() => load({ SEXTOU_SERVER_DATABASE_TIMEOUT_MS: timeout })).toThrow(
      `Invalid SEXTOU_SERVER_DATABASE_TIMEOUT_MS: ${JSON.stringify(timeout)}`,
    );
  },
);

test('loadConfig reads SEXTOU_SERVER_DEV=false as false', () => {
  expect(load({ SEXTOU_SERVER_DEV: 'false' }).dev).toBe(false);
});

test.each(['', '1', 'yes', 'TRUE'])(
  'loadConfig rejects SEXTOU_SERVER_DEV %j',
  (dev) => {
    expect(() => load({ SEXTOU_SERVER_DEV: dev })).toThrow(
      `Invalid SEXTOU_SERVER_DEV: ${JSON.stringify(dev)}`,
    );
  },
);

test.each(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])(
  'loadConfig accepts log level %j',
  (level) => {
    expect(load({ SEXTOU_SERVER_LOG_LEVEL: level }).logLevel).toBe(level);
  },
);

test.each(['', 'INFO', 'verbose', '30'])(
  'loadConfig rejects log level %j',
  (level) => {
    expect(() => load({ SEXTOU_SERVER_LOG_LEVEL: level })).toThrow(
      `Invalid SEXTOU_SERVER_LOG_LEVEL: ${JSON.stringify(level)} (expected one of fatal, error, warn, info, debug, trace, silent)`,
    );
  },
);
