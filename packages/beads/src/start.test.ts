import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { layoutOf } from './layout';
import { isAlive, readRunFile, waitFor } from './processes';
import { DEFAULT_ORGANIZATION } from './service';
import { startBeads, type Beads, type StartOptions } from './start';
import { fetchOf, makeArchive, pinOf } from './test/archives';
import { freePort, killRecorded, recordedCalls, wrapper } from './test/fakes';

let dir: string;
let dataDir: string;
let calls: string;
let doltPort: number;
let bdServePort: number;
const started: Beads[] = [];
const servers: Server[] = [];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-start-'));
  dataDir = join(dir, 'data');
  calls = join(dir, 'calls.jsonl');
  doltPort = await freePort();
  bdServePort = await freePort();
});

afterEach(async () => {
  await Promise.all(started.splice(0).map((beads) => beads.stop()));
  killRecorded(calls);
  for (const server of servers.splice(0)) server.close();
  rmSync(dir, { recursive: true, force: true });
});

// The fakes, packed as the pinned releases the binaries step downloads.
function options(
  { bdMode = 'normal', overrides = {} } = {} as {
    bdMode?: string;
    overrides?: Partial<StartOptions>;
  },
): StartOptions {
  const bd = makeArchive('bd', wrapper('fake-bd.ts', calls, bdMode));
  const dolt = makeArchive(
    'dolt-test/bin/dolt',
    wrapper('fake-dolt.ts', calls),
  );
  return {
    dataDir,
    pathEnv: process.env.PATH,
    windowsEnv: {},
    log: () => undefined,
    fetch: fetchOf(bd, dolt).fetch,
    pins: { bd: pinOf('bd', '1.3.1', bd), dolt: pinOf('Dolt', '2.2.0', dolt) },
    doltPort,
    bdServePort,
    readyTimeout: 5000,
    ...overrides,
  };
}

async function start(given = options()) {
  const beads = await startBeads(given);
  started.push(beads);
  return beads;
}

describe.runIf(process.platform !== 'win32')('startBeads', () => {
  it('runs the steps in order and returns a service that reaches bd serve', async () => {
    const beads = await start();

    expect(recordedCalls(calls).map((call) => call.argv[0])).toEqual([
      'sql-server',
      'init',
      'config',
      'serve',
    ]);
    await expect(beads.service.ping(DEFAULT_ORGANIZATION)).resolves.toBe(true);
  });

  it('stops bd serve on stop() and leaves Dolt running', async () => {
    const beads = await start();
    const [dolt, , , serve] = recordedCalls(calls);

    await beads.stop();
    started.pop();

    expect(await waitFor(() => !isAlive(serve.pid), 5000)).toBe(true);
    expect(readRunFile(layoutOf(dataDir).bdServeRun)).toBeUndefined();
    expect(isAlive(dolt.pid)).toBe(true);
    await expect(beads.service.ping(DEFAULT_ORGANIZATION)).resolves.toBe(false);
  });

  it('reuses Dolt and stops the leftover bd serve on the next start', async () => {
    // The server was killed: its bd serve is left running.
    await startBeads(options());
    const [dolt, , , leftover] = recordedCalls(calls);

    await start();

    expect(isAlive(leftover.pid)).toBe(false);
    const after = recordedCalls(calls).slice(4);
    expect(after.map((call) => call.argv[0])).toEqual([
      'init',
      'config',
      'serve',
    ]);
    expect(isAlive(dolt.pid)).toBe(true);
  });

  it('names the binaries step when a download fails', async () => {
    const given = options();
    await expect(
      startBeads({
        ...given,
        fetch: () => Promise.reject(new TypeError('fetch failed')),
      }),
    ).rejects.toMatchObject({
      step: 'binaries',
      message: expect.stringContaining('Could not download'),
    });
  });

  it('names the binaries step when git is missing', async () => {
    await expect(
      startBeads(options({ overrides: { pathEnv: '' } })),
    ).rejects.toMatchObject({
      step: 'binaries',
      message: 'binaries: git was not found on the PATH; beads needs it',
    });
  });

  it('names the dolt step when another process holds its port', async () => {
    const server = createServer().listen(doltPort, '127.0.0.1');
    servers.push(server);
    await once(server, 'listening');

    await expect(startBeads(options())).rejects.toMatchObject({
      step: 'dolt',
      message: `dolt: Port ${doltPort} is held by a process sextou did not start`,
    });
  });

  it('names the organization step, without the password bd printed', async () => {
    const error = await startBeads(options({ bdMode: 'init-fails' })).catch(
      (caught: Error) => caught,
    );
    const password = readFileSync(layoutOf(dataDir).doltPasswordFile, 'utf8');

    expect(error).toMatchObject({ step: 'organization' });
    expect((error as Error).message).toContain('bd init exited with code 1');
    expect((error as Error).message).not.toContain(password);
  });

  it('names the bd serve step, without the token bd printed', async () => {
    const error = await startBeads(options({ bdMode: 'serve-exit' })).catch(
      (caught: Error) => caught,
    );
    const token = readFileSync(layoutOf(dataDir).bdServeTokenFile, 'utf8');

    expect(error).toMatchObject({ step: 'bd serve' });
    expect((error as Error).message).toContain('[redacted]');
    expect((error as Error).message).not.toContain(token);
  });

  // Its pid is free once it exited, and could belong to another process.
  it('signals nothing on stop() once bd serve has exited', async () => {
    const beads = await start();
    const serve = recordedCalls(calls)[3];
    process.kill(serve.pid, 'SIGKILL');
    // Node reaps the child and records its exit together; until then the pid
    // is the server's own zombie, which no other process can hold.
    await waitFor(() => !isAlive(serve.pid), 5000);
    const kill = vi.spyOn(process, 'kill');

    try {
      await beads.stop();
      expect(kill).not.toHaveBeenCalled();
    } finally {
      kill.mockRestore();
    }
    started.pop();
  });
});
