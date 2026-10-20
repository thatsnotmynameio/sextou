import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureDolt, type DoltOptions } from './dolt';
import { layoutOf, prepareFolders, type Layout } from './layout';
import { isAlive, readRunFile, waitFor } from './processes';
import {
  fakeBinary,
  freePort,
  killRecorded,
  recordedCalls,
} from './test/fakes';

let dir: string;
let layout: Layout;
let calls: string;
let port: number;
const servers: Server[] = [];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-dolt-'));
  layout = layoutOf(join(dir, 'data'));
  prepareFolders(layout);
  calls = join(dir, 'calls.jsonl');
  port = await freePort();
});

afterEach(() => {
  killRecorded(calls);
  for (const server of servers.splice(0)) server.close();
  rmSync(dir, { recursive: true, force: true });
});

function options(overrides: Partial<DoltOptions> = {}): DoltOptions {
  return {
    binary:
      overrides.binary ?? fakeBinary(join(dir, 'dolt'), 'fake-dolt.ts', calls),
    version: '2.2.0',
    port,
    layout,
    env: { platform: process.platform, layout, windowsEnv: {} },
    ...overrides,
  };
}

describe.runIf(process.platform !== 'win32')('ensureDolt', () => {
  it('creates the password and starts Dolt detached on the port', async () => {
    await ensureDolt(options());

    const [call] = recordedCalls(calls);
    expect(call.argv).toEqual([
      'sql-server',
      '-H',
      '127.0.0.1',
      '-P',
      String(port),
      '--data-dir',
      layout.dolt,
      '--loglevel',
      'warning',
    ]);
    const password = readFileSync(layout.doltPassword, 'utf8');
    expect(call.env).toEqual({
      HOME: layout.doltHome,
      DOLT_ROOT_PATH: layout.doltHome,
      DOLT_DISABLE_EVENT_FLUSH: '1',
      DOLT_ROOT_PASSWORD: password,
      DOLT_ROOT_HOST: '127.0.0.1',
    });
    expect(readRunFile(layout.doltRun)).toEqual({
      pid: call.pid,
      port,
      version: '2.2.0',
    });
    // Its own process group: a Ctrl+C in the server's terminal misses it.
    const group = execFileSync('ps', ['-o', 'pgid=', '-p', String(call.pid)])
      .toString()
      .trim();
    expect(group).toBe(String(call.pid));
    expect(isAlive(call.pid)).toBe(true);
  });

  it('reuses the Dolt it started when it is still running', async () => {
    await ensureDolt(options());
    await ensureDolt(options());
    expect(recordedCalls(calls)).toHaveLength(1);
  });

  // Dolt applies the root password only when it creates privileges.db.
  it('starts Dolt without the root password once privileges.db exists', async () => {
    await ensureDolt(options());
    const [first] = recordedCalls(calls);
    process.kill(first.pid, 'SIGTERM');
    await waitFor(() => !isAlive(first.pid), 5000);

    await ensureDolt(options());

    const second = recordedCalls(calls)[1];
    expect(second.env).not.toHaveProperty('DOLT_ROOT_PASSWORD');
    expect(second.env).not.toHaveProperty('DOLT_ROOT_HOST');
  });

  it('replaces its Dolt on another version, after the old one exited', async () => {
    await ensureDolt(options({ version: '2.1.0' }));
    const [old] = recordedCalls(calls);

    await ensureDolt(options());

    expect(isAlive(old.pid)).toBe(false);
    const calledAfter = recordedCalls(calls);
    expect(calledAfter).toHaveLength(2);
    expect(readRunFile(layout.doltRun)).toEqual({
      pid: calledAfter[1].pid,
      port,
      version: '2.2.0',
    });
  });

  it('fails naming the port when another process holds it', async () => {
    const server = createServer().listen(port, '127.0.0.1');
    servers.push(server);
    await once(server, 'listening');

    await expect(ensureDolt(options())).rejects.toThrow(
      `Port ${port} is held by a process sextou did not start`,
    );
    expect(recordedCalls(calls)).toHaveLength(0);
  });

  // The run file names a live Dolt, but not the one serving this folder.
  it('fails naming the port for a Dolt serving another data directory', async () => {
    const other = layoutOf(join(dir, 'other'));
    prepareFolders(other);
    await ensureDolt(options({ layout: other }));
    mkdirSync(join(layout.dolt, '.dolt'), { recursive: true });
    writeFileSync(layout.doltRun, JSON.stringify(readRunFile(other.doltRun)));

    await expect(ensureDolt(options())).rejects.toThrow(`Port ${port}`);
  });

  it('fails naming both files when privileges.db exists without the password', async () => {
    mkdirSync(join(layout.dolt, '.doltcfg'), { recursive: true });
    writeFileSync(join(layout.dolt, '.doltcfg', 'privileges.db'), '');

    await expect(ensureDolt(options())).rejects.toThrow(
      `${join(layout.dolt, '.doltcfg', 'privileges.db')} exists but ${layout.doltPassword} is missing`,
    );
    expect(recordedCalls(calls)).toHaveLength(0);
  });

  it('fails with the log’s last lines when Dolt exits at once', async () => {
    const binary = fakeBinary(join(dir, 'dolt'), 'fake-dolt.ts', calls, 'exit');
    await expect(ensureDolt(options({ binary }))).rejects.toThrow(
      'Dolt exited before accepting connections: fake dolt: could not start',
    );
  });

  it('kills a Dolt that never accepts connections, and fails', async () => {
    const binary = fakeBinary(
      join(dir, 'dolt'),
      'fake-dolt.ts',
      calls,
      'never-ready',
    );
    await expect(
      ensureDolt(options({ binary, readyTimeout: 500 })),
    ).rejects.toThrow(`Dolt did not accept connections on port ${port}`);
    const [call] = recordedCalls(calls);
    expect(await waitFor(() => !isAlive(call.pid), 5000)).toBe(true);
  });

  it('fails when the binary cannot run', async () => {
    await expect(
      ensureDolt(options({ binary: join(dir, 'missing') })),
    ).rejects.toThrow('ENOENT');
    expect(existsSync(layout.doltRun)).toBe(false);
  });
});
