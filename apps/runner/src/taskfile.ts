import { type ChildProcessByStdio, execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { download } from './download';
import type { Logger } from '@sextou/logger';
import type { Execute, Result } from './runner';

// Runs each task's Taskfile from the repository its uses names: it
// downloads the repository at the uses' commit from GitHub into source/, in
// a folder of its own under the system's temporary folder, runs the Taskfile
// at the uses' path there with runTaskfile, beside the files it uses, and
// resolves with how the run ended. A task whose uses is null names nothing
// to run: it resolves failed, with why, and makes no folder. The Taskfile gets two
// variables: CONTEXT, the task's context as JSON ({} when it has none), and
// WORKSPACE, the path of workspace/, an empty folder beside source/ where
// the run does its work, as a checkout of another repository. A download
// that fails resolves failed, with download: and why, and runs nothing. The
// folder is removed once the run ends, without waiting for it: a large
// folder takes a while, and the run's result is already settled. A folder
// that can't be removed, as one the run made read-only, is logged and left
// behind.
export function taskfileExecute({
  githubUrl,
  downloadTimeoutMs,
  tarBin,
  ...options
}: Pick<TaskfileOptions, 'bin' | 'timeoutMs' | 'killGraceMs'> & {
  githubUrl: string;
  downloadTimeoutMs: number;
  // tar's binary, which extracts the repository: `tar` on the PATH, or a path.
  tarBin: string;
}): Execute {
  return async ({ uses, context }, { signal, logger }) => {
    if (uses === null) {
      return {
        outcome: 'failed',
        reason: 'the task names nothing to run: it has no uses',
      };
    }
    const dir = await mkdtemp(join(tmpdir(), 'sextou-execution-'));
    try {
      const repository = join(dir, 'source');
      const workspace = join(dir, 'workspace');
      await Promise.all([mkdir(repository), mkdir(workspace)]);
      const failed = await download({
        bin: tarBin,
        githubUrl,
        repo: uses.repo,
        sha: uses.sha,
        dir: repository,
        timeoutMs: downloadTimeoutMs,
        signal,
      });
      if (failed !== undefined) {
        return { outcome: 'failed', reason: `download: ${failed}` };
      }
      return await runTaskfile({
        ...options,
        taskfile: join(repository, uses.taskfile),
        vars: { CONTEXT: contextVar(context), WORKSPACE: workspace },
        logger,
        signal,
      });
    } finally {
      rm(dir, { recursive: true }).catch((error: Error) =>
        logger.warn({ dir, error: error.message }, 'folder not removed'),
      );
    }
  };
}

// The context as the value of a go-task variable: JSON, with every {{
// written {\u007b, which JSON reads back as {{. go-task reads a variable given
// on its command line as a template, so a {{ in the context would run as one,
// reading the run's environment, say; JSON has no {{ outside its strings. A
// Taskfile reads it with fromJson, which gives the {{ back:
//
//   vars:
//     INPUT:
//       ref: fromJson .CONTEXT
//
// then quotes each value it writes into a command with q, since a template
// is pasted into the command as text: {{.INPUT.repo | q}}.
function contextVar(context: Record<string, unknown> | null): string {
  return JSON.stringify(context ?? {}).replaceAll('{{', String.raw`{\u007b`);
}

// Resolves with why `bin` can't run Taskfiles, or undefined when it's
// go-task: it doesn't start, it takes longer than `timeoutMs` to print its
// help, or its help names no --taskfile, as Taskwarrior's `task` doesn't.
export function checkGoTask(
  bin: string,
  timeoutMs: number,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      bin,
      ['--help'],
      { timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (`${stdout}${stderr}`.includes('--taskfile')) {
          resolve(undefined);
        } else if (error?.killed) {
          resolve('timeout');
        } else if (typeof error?.code === 'string') {
          resolve(error.message);
        } else {
          resolve('its help names no --taskfile');
        }
      },
    );
  });
}

export interface TaskfileOptions {
  // The go-task binary, from the host: `task` on the PATH, or a path. Some
  // distributions name it go-task.
  bin: string;
  // The Taskfile whose default task runs. go-task runs in the Taskfile's
  // folder, as do its commands, so no .taskrc.yml or USER_WORKING_DIR of the
  // runner's own folder reaches the run.
  taskfile: string;
  // Variables the default task gets, as go-task's command line sets them:
  // global, so a Taskfile it includes sees them too. go-task reads each value
  // as a template.
  vars: Record<string, string>;
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
// signals whole, as does the runner's own exit; once the run ends, whatever
// of the group is left is killed, so nothing it started outlives it. Process
// groups are POSIX's: it doesn't run on Windows.
export function runTaskfile({
  bin,
  taskfile,
  vars,
  timeoutMs,
  killGraceMs,
  logger,
  signal,
}: TaskfileOptions): Promise<Result> {
  if (signal.aborted) {
    return Promise.resolve({ outcome: 'failed', reason: 'aborted' });
  }
  return new Promise((resolve) => {
    const assignments = Object.entries(vars).map(
      ([name, value]) => `${name}=${value}`,
    );
    const args = ['--exit-code', '--taskfile', taskfile, 'default'];
    let child: ChildProcessByStdio<null, Readable, Readable>;
    // spawn emits most errors, but throws some, as E2BIG for a command line
    // longer than the system takes.
    try {
      child = spawn(bin, [...args, ...assignments], {
        cwd: dirname(taskfile),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ outcome: 'failed', reason: (error as Error).message });
      return;
    }
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
        // Every process in the group already exited, or go-task never started
        // and there is no group.
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
      // A command that went to the background without the output, or that
      // ignored a stop's SIGTERM, is still in the group.
      signalGroup('SIGKILL');
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
