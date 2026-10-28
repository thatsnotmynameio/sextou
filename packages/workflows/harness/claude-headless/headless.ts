import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { type Harness, type Output, runHarness } from '../agnostic-cli/run.ts';
import {
  defaultKillGraceMs,
  readBin,
  readTimeout,
} from '../../shared/settings.ts';
import { defaultTimeoutMs, readArgs } from './settings.ts';

// The core's exit codes, under claude's names: 2 on an input it refuses,
// having run no claude; 127 when claude doesn't run; 124 when claude took
// longer than CLAUDE_HEADLESS_TIMEOUT_MS, which stops it, as timeout(1)
// does: SIGTERM, then SIGKILL once CLAUDE_HEADLESS_KILL_GRACE_MS went by.
export { notRun as noClaude, refused, timedOut } from '../agnostic-cli/run.ts';

// Runs claude -p in the run's workspace (CLAUDE_HEADLESS_WORKSPACE) with
// the prompt and the options the task's context names
// (CLAUDE_HEADLESS_CONTEXT, as JSON), through the agnostic core. `env` is
// the environment claude runs with, the runner's, where its login or its key
// is, but for the CLAUDE_HEADLESS_ variables, which are this script's.
// claude is the program CLAUDE_HEADLESS_BIN names, a command on the PATH or
// an absolute path, claude on the PATH when it is unset or empty.
//
// An action that keeps its skills in its own folder, in .claude/skills/,
// hands that folder as `folder`, an absolute path, from its code, such as
// its main.ts's import.meta.dirname: a relative one would be checked here
// against node's folder and read by claude against its own. The folder exists only in
// the runner's download, so no context can name it. claude gets it as one
// more --add-dir, after the context's addDir, and a folder that holds no
// .claude/skills folder is refused. claude loads those skills only while the
// project setting source is on: a context whose settingSources leaves out
// project, or that sets safeMode, keeps them from loading, with no error.
//
// Resolves with the exit code: refused, noClaude, timedOut, else claude's.
export function headless(
  env: NodeJS.ProcessEnv,
  output: Output,
  folder?: string,
): Promise<number> {
  return runHarness(
    claude(env, folder),
    {
      // Stryker disable next-line StringLiteral: any text but JSON refuses the same
      context: env.CLAUDE_HEADLESS_CONTEXT ?? '',
      // Stryker disable next-line StringLiteral: any path but an absolute one refuses the same
      workspace: env.CLAUDE_HEADLESS_WORKSPACE ?? '',
      env,
    },
    output,
  );
}

// claude as the core runs it, with its program, timeout and grace from
// `env`, the runner's environment, and the action's `folder`, when it
// handed one.
function claude(env: NodeJS.ProcessEnv, folder: string | undefined): Harness {
  return {
    name: 'claude-headless',
    program: 'claude',
    ownVariables: 'CLAUDE_HEADLESS_',
    prepare: (fields) => {
      const read = readArgs(fields);
      if (!read.ok) {
        return read;
      }
      const timeoutMs = readTimeout(
        env.CLAUDE_HEADLESS_TIMEOUT_MS,
        defaultTimeoutMs,
      );
      if (timeoutMs === undefined) {
        return refuse(
          'CLAUDE_HEADLESS_TIMEOUT_MS is a whole number of milliseconds from 1 to 2147483647',
        );
      }
      const killGraceMs = readTimeout(
        env.CLAUDE_HEADLESS_KILL_GRACE_MS,
        defaultKillGraceMs,
      );
      if (killGraceMs === undefined) {
        return refuse(
          'CLAUDE_HEADLESS_KILL_GRACE_MS is a whole number of milliseconds from 1 to 2147483647',
        );
      }
      const bin = readBin(env.CLAUDE_HEADLESS_BIN, 'claude');
      if (bin === undefined) {
        return refuse(
          'CLAUDE_HEADLESS_BIN is a command on the PATH or an absolute path',
        );
      }
      const args =
        folder === undefined
          ? read.args
          : [...read.args, `--add-dir=${folder}`];
      return { ok: true, bin, args, timeoutMs, killGraceMs };
    },
    check: folder === undefined ? undefined : () => checkSkills(folder),
  };
}

// Why the action's `folder` is refused, when it holds no .claude/skills
// folder for claude to load; undefined when it does.
async function checkSkills(folder: string) {
  const skills = await stat(join(folder, '.claude', 'skills')).catch(
    () => undefined,
  );
  return skills?.isDirectory()
    ? undefined
    : `${folder} holds a .claude/skills folder`;
}

function refuse(reason: string) {
  return { ok: false as const, reason };
}
