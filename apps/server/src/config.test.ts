import { expect, test } from 'vitest';
import { loadConfig, type PathContext } from './config';

const paths: PathContext = {
  platform: 'linux',
  homedir: () => '/home/ana',
  cwd: '/work',
};
const defaultDataDir = '/home/ana/.local/share/sextou';
const defaultDatabase = `${defaultDataDir}/sextou.db`;
const defaultTasks = `${defaultDataDir}/default.tasks.db`;

function load(env: Record<string, string | undefined>, args: string[]) {
  return loadConfig(env, args, paths);
}

test('loadConfig listens on 127.0.0.1:4310 by default', () => {
  expect(load({}, [])).toEqual({
    host: '127.0.0.1',
    port: 4310,
    dataDir: defaultDataDir,
    database: defaultDatabase,
    tasks: defaultTasks,
  });
});

test('loadConfig reads the host and port from the environment', () => {
  expect(
    load({ SEXTOU_SERVER_HOST: '0.0.0.0', SEXTOU_SERVER_PORT: '8080' }, []),
  ).toEqual({
    host: '0.0.0.0',
    port: 8080,
    dataDir: defaultDataDir,
    database: defaultDatabase,
    tasks: defaultTasks,
  });
});

test('loadConfig lets the arguments override the environment', () => {
  expect(
    load({ SEXTOU_SERVER_HOST: '0.0.0.0', SEXTOU_SERVER_PORT: '8080' }, [
      '--host',
      '::1',
      '--port',
      '9090',
    ]),
  ).toEqual({
    host: '::1',
    port: 9090,
    dataDir: defaultDataDir,
    database: defaultDatabase,
    tasks: defaultTasks,
  });
});

test('loadConfig accepts port 0, for a port the system picks', () => {
  expect(load({}, ['--port', '0']).port).toBe(0);
});

const invalidPorts = ['', 'abc', '0x50', '1e3', '-1', '65536'];

test.each(invalidPorts)(
  'loadConfig rejects port %j from SEXTOU_SERVER_PORT',
  (port) => {
    expect(() => load({ SEXTOU_SERVER_PORT: port }, [])).toThrow(
      `Invalid SEXTOU_SERVER_PORT: ${JSON.stringify(port)}`,
    );
  },
);

test.each(invalidPorts)('loadConfig rejects port %j from --port', (port) => {
  expect(() => load({}, [`--port=${port}`])).toThrow(
    `Invalid --port: ${JSON.stringify(port)}`,
  );
});

// An empty host would bind every interface, not loopback.
test('loadConfig rejects an empty host from SEXTOU_SERVER_HOST', () => {
  expect(() => load({ SEXTOU_SERVER_HOST: '' }, [])).toThrow(
    'Invalid SEXTOU_SERVER_HOST: ""',
  );
});

test('loadConfig rejects an empty host from --host', () => {
  expect(() => load({}, ['--host='])).toThrow('Invalid --host: ""');
});

test('loadConfig rejects an unknown flag', () => {
  expect(() => load({}, ['--verbose'])).toThrow("'--verbose'");
});

test('loadConfig puts the database in the data directory by default', () => {
  expect(load({ XDG_DATA_HOME: '/data' }, []).database).toBe(
    '/data/sextou/sextou.db',
  );
});

test('loadConfig reads the database path from the environment', () => {
  expect(load({ SEXTOU_SERVER_DATABASE: '/a.db' }, []).database).toBe('/a.db');
});

test('loadConfig lets --database override the environment', () => {
  expect(
    load({ SEXTOU_SERVER_DATABASE: '/a.db' }, ['--database', '/b.db']).database,
  ).toBe('/b.db');
});

test('loadConfig resolves a relative database path against the working directory', () => {
  expect(load({}, ['--database', 'data.db']).database).toBe('/work/data.db');
});

test('loadConfig keeps :memory: as it is', () => {
  expect(load({}, ['--database', ':memory:']).database).toBe(':memory:');
});

test('loadConfig does not read the home directory when both paths are given', () => {
  const config = loadConfig({}, ['--data-dir', '/d', '--database', '/b.db'], {
    ...paths,
    homedir: () => {
      throw new Error('read the home directory');
    },
  });
  expect(config).toMatchObject({ dataDir: '/d', database: '/b.db' });
});

test('loadConfig puts everything in --data-dir', () => {
  expect(load({}, ['--data-dir', '/d'])).toMatchObject({
    dataDir: '/d',
    database: '/d/sextou.db',
    tasks: '/d/default.tasks.db',
  });
});

test('loadConfig keeps a configured database outside the data directory, and the tasks in it', () => {
  expect(load({}, ['--data-dir', '/d', '--database', '/x.db'])).toMatchObject({
    dataDir: '/d',
    database: '/x.db',
    tasks: '/d/default.tasks.db',
  });
});

test('loadConfig reads the data directory from the environment', () => {
  expect(load({ SEXTOU_SERVER_DATA_DIR: '/e' }, [])).toMatchObject({
    dataDir: '/e',
    database: '/e/sextou.db',
    tasks: '/e/default.tasks.db',
  });
});

test('loadConfig lets --data-dir override the environment', () => {
  expect(
    load({ SEXTOU_SERVER_DATA_DIR: '/e' }, ['--data-dir', '/d']).dataDir,
  ).toBe('/d');
});

test('loadConfig resolves a relative data directory against the working directory', () => {
  expect(load({}, ['--data-dir', 'data']).dataDir).toBe('/work/data');
});

test('loadConfig rejects an empty data directory from SEXTOU_SERVER_DATA_DIR', () => {
  expect(() => load({ SEXTOU_SERVER_DATA_DIR: '' }, [])).toThrow(
    'Invalid SEXTOU_SERVER_DATA_DIR: ""',
  );
});

test('loadConfig rejects an empty data directory from --data-dir', () => {
  expect(() => load({}, ['--data-dir='])).toThrow('Invalid --data-dir: ""');
});

// SQLite opens an empty path as a temporary database, deleted on close.
test('loadConfig rejects an empty database path from SEXTOU_SERVER_DATABASE', () => {
  expect(() => load({ SEXTOU_SERVER_DATABASE: '' }, [])).toThrow(
    'Invalid SEXTOU_SERVER_DATABASE: ""',
  );
});

test('loadConfig rejects an empty database path from --database', () => {
  expect(() => load({}, ['--database='])).toThrow('Invalid --database: ""');
});
