import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  startBdServe,
  stopLeftoverBdServe,
  type BdServeOptions,
} from './bd-serve';
import { layoutOf, prepareFolders, type Layout } from './layout';
import { findGit } from './platform';
import { isAlive, readRunFile, waitFor, writeRunFile } from './processes';
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
const children: ChildProcess[] = [];
const servers: Server[] = [];
const git = findGit(process.env.PATH, process.platform);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-bd-serve-'));
  layout = layoutOf(join(dir, 'data'));
  prepareFolders(layout);
  // The organization step leaves its folder a git repository.
  mkdirSync(join(layout.organization, '.git'));
  calls = join(dir, 'calls.jsonl');
  port = await freePort();
});

afterEach(() => {
  killRecorded(calls);
  for (const child of children.splice(0)) child.kill('SIGKILL');
  for (const server of servers.splice(0)) server.close();
  rmSync(dir, { recursive: true, force: true });
});

function options(overrides: Partial<BdServeOptions> = {}): BdServeOptions {
  return {
    bd: overrides.bd ?? fakeBinary(join(dir, 'bd'), 'fake-bd.ts', calls),
    git,
    port,
    doltPassword: 'the-password',
    layout,
    env: { platform: process.platform, layout, windowsEnv: {} },
    ...overrides,
  };
}

// A child that listens on port and keeps running, standing in for a
// leftover bd serve, or holding no port when listenPort is undefined.
async function leftover(listenPort: number | undefined) {
  const script =
    listenPort === undefined
      ? "console.log('ready'); setInterval(() => {}, 1000)"
      : `require('node:net').createServer().listen(${listenPort}, '127.0.0.1', () => console.log('ready'))`;
  const child = spawn(process.execPath, ['-e', script]);
  children.push(child);
  await once(child.stdout, 'data');
  return child;
}

describe.runIf(process.platform !== 'win32')('startBdServe', () => {
  it('starts bd serve with the token and resolves once it is ready', async () => {
    const serve = await startBdServe(options());
    children.push(serve.child);

    const [call] = recordedCalls(calls);
    expect(call.argv).toEqual([
      'serve',
      '--addr',
      `127.0.0.1:${port}`,
      '--auth-token-file',
      layout.bdServeToken,
    ]);
    expect(call.cwd).toBe(layout.organization);
    expect(call.env).toEqual({
      HOME: layout.doltHome,
      PATH: join(git, '..'),
      BEADS_DIR: layout.beadsDir,
      BEADS_DOLT_PASSWORD: 'the-password',
      BEADS_DOLT_AUTO_START: '0',
      BD_DISABLE_METRICS: '1',
    });
    expect(serve.token).toBe(readFileSync(layout.bdServeToken, 'utf8'));
    expect(readRunFile(layout.bdServeRun)).toEqual({ pid: call.pid, port });
  });

  it('kills a bd serve that never gets ready, and fails', async () => {
    const bd = fakeBinary(join(dir, 'bd'), 'fake-bd.ts', calls, 'serve-503');

    await expect(
      startBdServe(options({ bd, readyTimeout: 500 })),
    ).rejects.toThrow(`bd serve was not ready on port ${port} within 0.5 s`);
    const [call] = recordedCalls(calls);
    expect(await waitFor(() => !isAlive(call.pid), 5000)).toBe(true);
  });

  it('fails with the log’s last lines when bd serve exits at once', async () => {
    const bd = fakeBinary(join(dir, 'bd'), 'fake-bd.ts', calls, 'serve-exit');

    await expect(startBdServe(options({ bd }))).rejects.toThrow(
      'bd serve exited before it was ready: fake bd: cannot determine repository root',
    );
  });

  it('fails when the binary cannot run', async () => {
    await expect(
      startBdServe(options({ bd: join(dir, 'missing') })),
    ).rejects.toThrow('ENOENT');
  });
});

describe.runIf(process.platform !== 'win32')('stopLeftoverBdServe', () => {
  it('stops a recorded bd serve that still holds its port', async () => {
    const serve = await startBdServe(options());

    await stopLeftoverBdServe(layout);

    expect(await waitFor(() => !isAlive(serve.child.pid as number), 5000)).toBe(
      true,
    );
    expect(readRunFile(layout.bdServeRun)).toBeUndefined();
  });

  it('leaves a recorded pid alone when it does not hold the port', async () => {
    const child = await leftover(undefined);
    writeRunFile(layout.bdServeRun, { pid: child.pid as number, port });

    await stopLeftoverBdServe(layout);

    expect(isAlive(child.pid as number)).toBe(true);
    expect(readRunFile(layout.bdServeRun)).toBeUndefined();
  });

  it('removes the run file of a pid that already exited', async () => {
    const child = await leftover(port);
    child.kill('SIGKILL');
    await once(child, 'exit');
    writeRunFile(layout.bdServeRun, { pid: child.pid as number, port });

    await stopLeftoverBdServe(layout);

    expect(readRunFile(layout.bdServeRun)).toBeUndefined();
  });

  it('does nothing without a run file', async () => {
    const server = createServer().listen(port, '127.0.0.1');
    servers.push(server);
    await once(server, 'listening');
    await expect(stopLeftoverBdServe(layout)).resolves.toBeUndefined();
  });
});
