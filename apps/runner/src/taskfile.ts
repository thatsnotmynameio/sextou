import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { Logger } from './logger';
import type { Result } from './runner';

// The go-task binary @go-task/cli downloads on install. Its own `task`
// command is a Node script that runs this one with spawnSync: a signal it
// gets never reaches go-task, and it exits 0 when go-task died of one.
export function goTaskBin(platform: NodeJS.Platform = process.platform) {
  const cli = dirname(
    fileURLToPath(import.meta.resolve('@go-task/cli/package.json')),
  );
  return join(cli, 'bin', platform === 'win32' ? 'task.exe' : 'task');
}

export interface TaskfileOptions {
  // The go-task binary.
  bin: string;
  // The Taskfile whose default task runs. go-task runs its commands in the
  // Taskfile's folder.
  taskfile: string;
  // How long the run may take before it is stopped and fails as timeout.
  timeoutMs: number;
  // How long a stopped run has to exit after SIGTERM before SIGKILL.
  killGraceMs: number;
  // Gets each line the run writes, as an output record.
  logger: Logger;
  // Stops the run once it aborts.
  signal: AbortSignal;
}

// Runs the default task of a Taskfile with go-task, and resolves with how it
// ended: succeeded on exit code 0, else failed with the exit code (go-task's
// --exit-code passes the failed command's own through), the signal that
// ended it, timeout, or the error that kept it from starting. go-task and
// every command it starts run in a process group of their own, which a stop
// signals whole: a command left behind would keep the output open, and the
// run would never end. Process groups are POSIX's: it doesn't run on Windows.
export function runTaskfile({
  bin,
  taskfile,
  timeoutMs,
  killGraceMs,
  logger,
  signal,
}: TaskfileOptions): Promise<Result> {
  if (signal.aborted) {
    return Promise.resolve({ outcome: 'failed', reason: 'aborted' });
  }
  return new Promise((resolve) => {
    const child = spawn(bin, ['--exit-code', '--taskfile', taskfile], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // The run stops once, on the first of an abort and the timeout.
    const timeout = AbortSignal.timeout(timeoutMs);
    const stop = AbortSignal.any([signal, timeout]);
    let killTimer: NodeJS.Timeout | undefined;
    const signalGroup = (name: NodeJS.Signals) => {
      try {
        process.kill(-(child.pid as number), name);
      } catch {
        // The group already exited.
      }
    };
    const kill = () => {
      signalGroup('SIGTERM');
      killTimer = setTimeout(() => signalGroup('SIGKILL'), killGraceMs);
    };
    stop.addEventListener('abort', kill, { once: true });
    const settle = (result: Result) => {
      clearTimeout(killTimer);
      // A run that ended unstopped would leave its kill, and the child, on a
      // signal that may outlive it.
      // Stryker disable next-line StringLiteral,CallExpression: a leak only
      stop.removeEventListener('abort', kill);
      resolve(result);
    };

    log(child.stdout, 'stdout', logger);
    log(child.stderr, 'stderr', logger);
    child.on('error', (error) => {
      settle({ outcome: 'failed', reason: error.message });
    });
    child.on('close', (code, signalName) => {
      if (timeout.aborted) {
        settle({ outcome: 'failed', reason: 'timeout' });
      } else if (code === 0) {
        settle({ outcome: 'succeeded' });
      } else if (code === null) {
        settle({ outcome: 'failed', reason: `signal ${signalName}` });
      } else {
        settle({ outcome: 'failed', reason: `exit code ${code}` });
      }
    });
  });
}

function log(stream: Readable, name: 'stdout' | 'stderr', logger: Logger) {
  createInterface({ input: stream, crlfDelay: Infinity }).on('line', (line) =>
    logger.info({ stream: name, line }, 'output'),
  );
}
