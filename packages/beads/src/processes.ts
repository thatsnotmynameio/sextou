import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

// What sextou records about a process it started, right after spawning it.
export interface RunRecord {
  pid: number;
  port: number;
  version?: string;
}

// The record in file; a missing or unreadable one reads as absent.
export function readRunFile(file: string): RunRecord | undefined {
  try {
    const record: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const { pid, port, version } = (record ?? {}) as Partial<RunRecord>;
    if (typeof pid !== 'number' || typeof port !== 'number') return undefined;
    return typeof version === 'string' ? { pid, port, version } : { pid, port };
  } catch {
    return undefined;
  }
}

export function writeRunFile(file: string, record: RunRecord) {
  writeFileSync(file, JSON.stringify(record), { mode: 0o600 });
}

// The log's last lines, for an error message.
export function lastLines(file: string, count = 10): string {
  try {
    return readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .slice(-count)
      .join('\n');
  } catch {
    return '(no log)';
  }
}

export function removeRunFile(file: string) {
  rmSync(file, { force: true });
}

// Whether a process with this pid exists. EPERM means it exists under
// another user.
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// Whether something accepts TCP connections on this loopback port.
export function portAccepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    const done = (accepts: boolean) => {
      socket.destroy();
      resolve(accepts);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

// Checks every interval until check passes or the deadline, in milliseconds,
// runs out. Resolves whether it passed.
export async function waitFor(
  check: () => boolean | Promise<boolean>,
  deadline: number,
  interval = 100,
): Promise<boolean> {
  const end = Date.now() + deadline;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= end) return false;
    await sleep(interval);
  }
}

// Sends SIGTERM, waits up to the deadline for the process to exit, then sends
// SIGKILL and waits for it to go. Does nothing for a pid that already exited.
export async function stopProcess(pid: number, deadline: number) {
  if (!signal(pid, 'SIGTERM')) return;
  if (await waitFor(() => !isAlive(pid), deadline)) return;
  signal(pid, 'SIGKILL');
  await waitFor(() => !isAlive(pid), 5000);
}

// Whether the signal reached the process: false once it exited.
function signal(pid: number, name: NodeJS.Signals): boolean {
  try {
    process.kill(pid, name);
    return true;
  } catch {
    return false;
  }
}

// Waits for a child sextou just spawned to get ready, recording it in
// runFile meanwhile. Throws exitedMessage with the log's last lines when it
// exits first; kills it and throws notReadyMessage at the deadline, in
// milliseconds.
export async function awaitReady(
  child: ChildProcess,
  {
    runFile,
    record,
    log,
    ready,
    deadline,
    exitedMessage,
    notReadyMessage,
  }: {
    runFile: string;
    record: Omit<RunRecord, 'pid'>;
    log: string;
    ready: () => Promise<boolean>;
    deadline: number;
    exitedMessage: string;
    notReadyMessage: string;
  },
): Promise<void> {
  let exited = false;
  const failed = new Promise<never>((_, reject) => {
    child.once('error', reject);
    child.once('exit', () => {
      exited = true;
      reject(new Error(`${exitedMessage}: ${lastLines(log)}`));
    });
  });
  failed.catch(() => undefined);
  if (child.pid !== undefined) {
    writeRunFile(runFile, { pid: child.pid, ...record });
  }

  const isReady = await Promise.race([
    waitFor(async () => exited || (await ready()), deadline),
    failed,
  ]);
  if (exited) await failed;
  if (!isReady) {
    child.kill('SIGKILL');
    removeRunFile(runFile);
    throw new Error(notReadyMessage);
  }
}

// Runs a command to its end. Rejects naming it, with its stderr, when it
// can't run or exits with another code than 0, and kills it when it runs past
// the deadline, in milliseconds, so a hung command can't stall the start.
export function runToEnd(
  name: string,
  command: string,
  args: string[],
  {
    cwd,
    env,
    deadline = 120_000,
  }: { cwd: string; env: Record<string, string>; deadline?: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, deadline);
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not run ${name}: ${error.message}`));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else if (timedOut) {
        reject(new Error(`${name} did not finish within ${deadline / 1000} s`));
      } else {
        reject(new Error(`${name} exited with code ${code}: ${stderr.trim()}`));
      }
    });
  });
}
