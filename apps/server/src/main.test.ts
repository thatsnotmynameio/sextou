import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BeadsStartError, startBeads, type Beads } from '@sextou/beads';
import { healthResponseSchema } from '@sextou/contract';
import { openDatabase, type Database } from '@sextou/data';
import type { Hono } from 'hono';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import packageJson from '../package.json';
import { startServer } from './server';

vi.mock('./server', () => ({
  startServer: vi.fn(() =>
    Promise.resolve({
      host: '127.0.0.1',
      port: 54321,
      close: () => Promise.resolve(),
    }),
  ),
}));

// No test downloads or runs bd or Dolt: startBeads is a stub each test
// shapes, with the package's real error class.
vi.mock('@sextou/beads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sextou/beads')>()),
  startBeads: vi.fn(),
}));

// The real package, watched so each test can reach the database main opened.
vi.mock('@sextou/data', async (importOriginal) => {
  const data = await importOriginal<typeof import('@sextou/data')>();
  return { openDatabase: vi.fn(data.openDatabase) };
});

let dir: string;
let beads: Beads;
let beadsAnswers: boolean;
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

function stubBeads(): Beads {
  return {
    service: { ping: vi.fn(() => Promise.resolve(beadsAnswers)) },
    stop: vi.fn(() => Promise.resolve()),
  };
}

function openedDatabase(): Database {
  return vi.mocked(openDatabase).mock.results[0].value as Database;
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
  // No test may reach the developer's data directory.
  vi.stubEnv('HOME', dir);
  vi.stubEnv('XDG_DATA_HOME', undefined);
  vi.stubEnv('SEXTOU_SERVER_HOST', undefined);
  vi.stubEnv('SEXTOU_SERVER_PORT', undefined);
  vi.stubEnv('SEXTOU_SERVER_DATABASE', undefined);
  vi.stubEnv('SEXTOU_SERVER_DATA_DIR', undefined);
  beadsAnswers = true;
  beads = stubBeads();
  vi.mocked(startBeads).mockImplementation(() => Promise.resolve(beads));
  on = vi.spyOn(process, 'on').mockImplementation(() => process);
  off = vi.spyOn(process, 'off').mockImplementation(() => process);
  exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const result of vi.mocked(openDatabase).mock.results) {
    if (result.type === 'return') result.value.close();
  }
  process.exitCode = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

it('starts the server from the arguments and prints where it listens', async () => {
  args('--port', '0', '--data-dir', dir, '--database', ':memory:');

  await import('./main');

  expect(startServer).toHaveBeenCalledOnce();
  const [app, config] = vi.mocked(startServer).mock.calls[0];
  expect(config).toEqual({
    host: '127.0.0.1',
    port: 0,
    dataDir: dir,
    database: ':memory:',
  });
  // The app reports the package's version, an uptime counted from the start
  // just now, and the database it opened.
  const response = await (app as Hono).request('/health');
  expect(response.status).toBe(200);
  expect(healthResponseSchema.parse(await response.json())).toEqual({
    version: packageJson.version,
    uptimeSeconds: 0,
    database: 'up',
    beads: 'up',
  });
  expect(console.log).toHaveBeenCalledWith(
    'listening on http://127.0.0.1:54321',
  );
});

it('starts beads in the data directory, with the PATH for git', async () => {
  vi.stubEnv('PATH', '/usr/bin');
  args('--data-dir', dir, '--database', ':memory:');

  await import('./main');

  expect(startBeads).toHaveBeenCalledOnce();
  const [options] = vi.mocked(startBeads).mock.calls[0];
  expect(options).toMatchObject({ dataDir: dir, pathEnv: '/usr/bin' });
  options.log('Downloading bd');
  expect(console.log).toHaveBeenCalledWith('Downloading bd');
});

it('asks beads about the default organization on each health request', async () => {
  args('--database', ':memory:');
  await import('./main');
  const [app] = vi.mocked(startServer).mock.calls[0];

  beadsAnswers = false;
  const down = await (app as Hono).request('/health');
  expect(down.status).toBe(503);
  expect(await down.json()).toMatchObject({ beads: 'down' });
  beadsAnswers = true;
  expect((await (app as Hono).request('/health')).status).toBe(200);
  expect(beads.service.ping).toHaveBeenCalledTimes(2);
  expect(beads.service.ping).toHaveBeenCalledWith('default');
});

it('brackets an IPv6 address in the listening URL', async () => {
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
it.runIf(process.platform === 'linux')(
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

it('opens the database, then starts beads, then listens', async () => {
  args('--database', ':memory:');

  await import('./main');

  expect(vi.mocked(openDatabase).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(startBeads).mock.invocationCallOrder[0],
  );
  expect(vi.mocked(startBeads).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(startServer).mock.invocationCallOrder[0],
  );
});

describe('when beads cannot start', () => {
  it('exits with 1 naming the step, closes the database, and never listens', async () => {
    vi.mocked(startBeads).mockRejectedValueOnce(
      new BeadsStartError(
        'binaries',
        'Could not download https://x: fetch failed',
      ),
    );
    args('--database', ':memory:');

    await import('./main');

    expect(startServer).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'Could not start beads (binaries): Could not download https://x: fetch failed',
    );
    expect(openedDatabase().ping()).toBe(false);
    expect(on).not.toHaveBeenCalled();
  });
});

describe('when the database cannot be opened', () => {
  it('exits with 1 and names the path and the reason, without listening', async () => {
    writeFileSync(join(dir, 'file'), '');
    const path = join(dir, 'file', 'sextou.db');
    args('--database', path);

    await import('./main');

    expect(startServer).not.toHaveBeenCalled();
    expect(startBeads).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    // The reason is the file system's: the folder is a file.
    expect(console.error).toHaveBeenCalledWith(
      `Could not open the database at ${path}: EEXIST: file already exists, mkdir '${join(dir, 'file')}'`,
    );
    expect(on).not.toHaveBeenCalled();
  });
});

it('stops beads, closes the database and rethrows when listening fails', async () => {
  const error = Object.assign(new Error('listen EADDRINUSE'), {
    code: 'EADDRINUSE',
  });
  vi.mocked(startServer).mockRejectedValueOnce(error);
  args('--database', ':memory:');

  await expect(import('./main')).rejects.toBe(error);

  expect(beads.stop).toHaveBeenCalledOnce();
  expect(openedDatabase().ping()).toBe(false);
  expect(on).not.toHaveBeenCalled();
});

describe.each(['SIGTERM', 'SIGINT'])('on %s', (signal) => {
  it('closes the server, then stops beads, then closes the database, then exits with 0', async () => {
    let databaseAnsweredAtServerClose: boolean | undefined;
    let beadsStoppedAtServerClose: boolean | undefined;
    let databaseAnsweredAtBeadsStop: boolean | undefined;
    vi.mocked(startServer).mockResolvedValueOnce({
      host: '127.0.0.1',
      port: 54321,
      close: () => {
        databaseAnsweredAtServerClose = openedDatabase().ping();
        beadsStoppedAtServerClose = vi.mocked(beads.stop).mock.calls.length > 0;
        return Promise.resolve();
      },
    });
    vi.mocked(beads.stop).mockImplementation(() => {
      databaseAnsweredAtBeadsStop = openedDatabase().ping();
      return Promise.resolve();
    });
    exit.mockImplementation(((code: number) => {
      expect(openedDatabase().ping()).toBe(false);
      expect(code).toBe(0);
    }) as never);
    args('--database', ':memory:');
    await import('./main');

    await handler(signal)();

    expect(databaseAnsweredAtServerClose).toBe(true);
    expect(beadsStoppedAtServerClose).toBe(false);
    expect(databaseAnsweredAtBeadsStop).toBe(true);
    expect(beads.stop).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('stops listening for both signals, so shutdown runs once', async () => {
    args('--database', ':memory:');
    await import('./main');
    const shutdown = handler(signal);

    await shutdown();

    expect(handler('SIGINT')).toBe(shutdown);
    expect(handler('SIGTERM')).toBe(shutdown);
    expect(off).toHaveBeenCalledWith('SIGINT', shutdown);
    expect(off).toHaveBeenCalledWith('SIGTERM', shutdown);
  });
});
