import {
  notRun,
  type Harness,
  type Output,
  refused,
  runHarness,
  timedOut,
} from '../agnostic-cli/run.ts';
import {
  defaultKillGraceMs,
  readBin,
  readTimeout,
} from '../../shared/settings.ts';
import { defaultTimeoutMs, readArgs } from './settings.ts';

// Exits with 2 on an input it refuses, having run no claude.
export { refused };
// Exits with 127 when claude doesn't run.
export const noClaude = notRun;
// Exits with 124 when claude took longer than CLAUDE_HEADLESS_TIMEOUT_MS,
// which stops it, as timeout(1) does: SIGTERM, then SIGKILL once
// CLAUDE_HEADLESS_KILL_GRACE_MS went by.
export { timedOut };

// Runs claude -p in the run's workspace (CLAUDE_HEADLESS_WORKSPACE) with
// the prompt and the options the task's context names
// (CLAUDE_HEADLESS_CONTEXT, as JSON), through the agnostic core. `env` is
// the environment claude runs with, the runner's, where its login or its key
// is, but for the CLAUDE_HEADLESS_ variables, which are this script's.
// claude is the program CLAUDE_HEADLESS_BIN names, a command on the PATH or
// an absolute path, claude on the PATH when it is unset or empty.
// Resolves with the exit code: refused, noClaude, timedOut, else claude's.
export function headless(
  env: NodeJS.ProcessEnv,
  output: Output,
): Promise<number> {
  return runHarness(
    claude(env),
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
// `env`, the runner's environment.
function claude(env: NodeJS.ProcessEnv): Harness {
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
      return { ok: true, bin, args: read.args, timeoutMs, killGraceMs };
    },
  };
}

function refuse(reason: string) {
  return { ok: false as const, reason };
}
