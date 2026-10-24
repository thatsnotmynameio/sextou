import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type { Logger } from './logger';
import type { Execute, Result } from './runner';

// Runs each task's Taskfile, the plaintext its claim carries: it writes it to
// Taskfile.yml in a folder of its own under the system's temporary folder,
// runs its default task there with runTaskfile, and removes the folder once
// the run ends, however it ended.
export function taskfileExecute(
  options: Pick<TaskfileOptions, 'bin' | 'timeoutMs' | 'killGraceMs'>,
): Execute {
  return async (task, { signal, logger }) => {
    const dir = await mkdtemp(join(tmpdir(), 'sextou-run-'));
    try {
      const taskfile = join(dir, 'Taskfile.yml');
      await writeFile(taskfile, task.taskfile);
      return await runTaskfile({ ...options, taskfile, logger, signal });
    } finally {
      await rm(dir, { recursive: true });
    }
  };
}

export interface TaskfileOptions {
  // The go-task binary, from the host: `task` on the PATH, or a path. Some
  // distributions name it go-task.
  bin: string;
  // The Taskfile whose default task runs. go-task runs its commands in the
  // Taskfile's folder.
  taskfile: string;
  // How long the run may take before it is stopped and fails as timeout.
  timeoutMs: number;
  // How long a stopped run has to exit after SIGTERM before SIGKILL, and
  // how long its output may stay open once go-task exited.
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
// signals whole, as does the runner's own exit. Process groups are POSIX's:
// it doesn't run on Windows.
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
    // The run stops on the first of an abort and the timeout: an AbortSignal
    // aborts once.
    const timeout = AbortSignal.timeout(timeoutMs);
    const stop = AbortSignal.any([signal, timeout]);
    let exited = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    let closeTimer: NodeJS.Timeout | undefined;
    const signalGroup = (name: NodeJS.Signals) => {
      try {
        process.kill(-(child.pid as number), name);
      } catch {
        // Every process in the group already exited.
      }
    };
    const kill = () => {
      // A run that exited, whose close is still on its way, ended by itself,
      // even when the timeout fired meanwhile.
      if (exited) {
        return;
      }
      // Stryker disable next-line StringLiteral: process.kill reads '' as SIGTERM
      signalGroup('SIGTERM');
      timedOut = timeout.aborted;
      killTimer = setTimeout(() => signalGroup('SIGKILL'), killGraceMs);
    };
    // The group outlives the runner unless the runner kills it: on exit, as
    // through process.exit, which runs only what is synchronous.
    const killOnExit = () => signalGroup('SIGKILL');
    stop.addEventListener('abort', kill);
    process.on('exit', killOnExit);
    const settle = (result: Result) => {
      // Without it, a run that exited within its grace still gets a SIGKILL
      // for its group once the grace ends, which finds no process.
      // Stryker disable next-line CallExpression: a stray signal only
      clearTimeout(killTimer);
      // Without it, the output of a run that closed by itself is closed again
      // once the grace ends, which changes nothing.
      // Stryker disable next-line CallExpression: a stray close only
      clearTimeout(closeTimer);
      // A run that ended unstopped would leave its kill, and the child, on a
      // signal that may outlive it.
      // Stryker disable next-line StringLiteral,CallExpression: a leak only
      stop.removeEventListener('abort', kill);
      process.off('exit', killOnExit);
      resolve(result);
    };

    log(child.stdout, 'stdout', logger);
    log(child.stderr, 'stderr', logger);
    child.on('error', (error) => {
      settle({ outcome: 'failed', reason: error.message });
    });
    // A command that left the group, as one setsid starts in the background,
    // keeps the output open after go-task exited, and no stop reaches it: the
    // output gets killGraceMs more to close, then is closed.
    child.on('exit', () => {
      exited = true;
      closeTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
      }, killGraceMs);
    });
    child.on('close', (code, signalName) => {
      if (timedOut) {
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
