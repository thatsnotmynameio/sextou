import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isAlive,
  portAccepts,
  readRunFile,
  removeRunFile,
  stopProcess,
  waitFor,
  writeRunFile,
} from './processes';

let dir: string;
const children: ChildProcess[] = [];
const servers: Server[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-processes-'));
});

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  for (const server of servers.splice(0)) server.close();
  rmSync(dir, { recursive: true, force: true });
});

// A Node child running script, which signals it is ready on stdout.
async function child(script: string) {
  const process = spawn(globalThis.process.execPath, [
    '-e',
    `${script}; console.log('ready'); setInterval(() => {}, 1000)`,
  ]);
  children.push(process);
  await once(process.stdout, 'data');
  return process;
}

async function listener() {
  const server = createServer();
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

describe('run files', () => {
  it('round-trips the pid, port and version', () => {
    const file = join(dir, 'dolt.json');
    writeRunFile(file, { pid: 123, port: 4311, version: '2.2.0' });
    expect(readRunFile(file)).toEqual({
      pid: 123,
      port: 4311,
      version: '2.2.0',
    });
  });

  it('reads a missing file as absent', () => {
    expect(readRunFile(join(dir, 'missing.json'))).toBeUndefined();
  });

  it.each(['not json', '{"pid":"1","port":2}', 'null'])(
    'reads %j as absent',
    (content) => {
      const file = join(dir, 'bad.json');
      writeFileSync(file, content);
      expect(readRunFile(file)).toBeUndefined();
    },
  );

  it('removes a run file, and does nothing when it is missing', () => {
    const file = join(dir, 'dolt.json');
    writeRunFile(file, { pid: 1, port: 2 });
    removeRunFile(file);
    expect(readRunFile(file)).toBeUndefined();
    expect(() => removeRunFile(file)).not.toThrow();
  });
});

describe('isAlive', () => {
  it('is true for a running child and false once it exited', async () => {
    const running = await child('');
    expect(isAlive(running.pid as number)).toBe(true);
    running.kill('SIGKILL');
    await once(running, 'exit');
    expect(isAlive(running.pid as number)).toBe(false);
  });
});

describe('portAccepts', () => {
  it('is true for a port with a listener and false once it closed', async () => {
    const server = await listener();
    const { port } = server.address() as AddressInfo;
    expect(await portAccepts(port)).toBe(true);
    server.close();
    await once(server, 'close');
    expect(await portAccepts(port)).toBe(false);
  });
});

describe('waitFor', () => {
  it('resolves true as soon as the check passes', async () => {
    let calls = 0;
    expect(await waitFor(() => ++calls === 3, 5000, 10)).toBe(true);
    expect(calls).toBe(3);
  });

  it('resolves false at the deadline', async () => {
    expect(await waitFor(() => Promise.resolve(false), 50, 10)).toBe(false);
  });
});

describe.runIf(process.platform !== 'win32')('stopProcess', () => {
  it('stops a child that exits on SIGTERM before the deadline', async () => {
    const running = await child('');
    const started = Date.now();
    await stopProcess(running.pid as number, 5000);
    expect(isAlive(running.pid as number)).toBe(false);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('sends SIGKILL at the deadline to a child that ignores SIGTERM', async () => {
    const running = await child("process.on('SIGTERM', () => {})");
    const exited = once(running, 'exit');
    await stopProcess(running.pid as number, 300);
    expect(await exited).toEqual([null, 'SIGKILL']);
  });

  it('does nothing for a pid that already exited', async () => {
    const running = await child('');
    running.kill('SIGKILL');
    await once(running, 'exit');
    await expect(stopProcess(running.pid as number, 300)).resolves.toBe(
      undefined,
    );
  });
});
