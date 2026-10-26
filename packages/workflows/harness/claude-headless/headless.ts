import { stat } from 'node:fs/promises';
import { run } from '../../shared/run.ts';
import {
  defaultKillGraceMs,
  readBin,
  readTimeout,
} from '../../shared/settings.ts';
import { throughSymlink } from '../../shared/workspace.ts';
import { defaultTimeoutMs, readSettings } from './settings.ts';

// Exits with 2 on an input it refuses, having run no claude.
export const refused = 2;
// Exits with 127 when claude doesn't run.
export const noClaude = 127;
// Exits with 124 when claude took longer than CLAUDE_HEADLESS_TIMEOUT_MS,
// which stops it, as timeout(1) does: SIGTERM, then SIGKILL once
// CLAUDE_HEADLESS_KILL_GRACE_MS went by.
export const timedOut = 124;

// Where each line claude writes goes, by the stream it wrote it to.
interface Output {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

// Runs claude -p in the run's workspace (CLAUDE_HEADLESS_WORKSPACE) with
// the prompt and the options the task's context names
// (CLAUDE_HEADLESS_CONTEXT, as JSON). `env` is the environment claude runs
// with, the runner's, where its login or its key is, but for the
// CLAUDE_HEADLESS_ variables, which are this script's. claude is the program
// CLAUDE_HEADLESS_BIN names, a command on the PATH or an absolute path,
// claude on the PATH when it is unset or empty.
// Resolves with the exit code: refused, noClaude, timedOut, else claude's.
export async function headless(
  env: NodeJS.ProcessEnv,
  output: Output,
): Promise<number> {
  // Stryker disable next-line StringLiteral: any path but an absolute one refuses the same
  const workspace = env.CLAUDE_HEADLESS_WORKSPACE ?? '';
  // Stryker disable next-line StringLiteral: any text but JSON refuses the same
  const read = readSettings(env.CLAUDE_HEADLESS_CONTEXT ?? '', workspace);
  if (!read.ok) {
    output.stderr(`claude-headless: ${read.reason}`);
    return refused;
  }
  const timeoutMs = readTimeout(
    env.CLAUDE_HEADLESS_TIMEOUT_MS,
    defaultTimeoutMs,
  );
  if (timeoutMs === undefined) {
    output.stderr(
      'claude-headless: CLAUDE_HEADLESS_TIMEOUT_MS is a whole number of milliseconds from 1 to 2147483647',
    );
    return refused;
  }
  const killGraceMs = readTimeout(
    env.CLAUDE_HEADLESS_KILL_GRACE_MS,
    defaultKillGraceMs,
  );
  if (killGraceMs === undefined) {
    output.stderr(
      'claude-headless: CLAUDE_HEADLESS_KILL_GRACE_MS is a whole number of milliseconds from 1 to 2147483647',
    );
    return refused;
  }
  const bin = readBin(env.CLAUDE_HEADLESS_BIN, 'claude');
  if (bin === undefined) {
    output.stderr(
      'claude-headless: CLAUDE_HEADLESS_BIN is a command on the PATH or an absolute path',
    );
    return refused;
  }
  const { cwd, args, prompt } = read.settings;
  if (await throughSymlink(workspace, cwd)) {
    output.stderr('claude-headless: path is inside the workspace');
    return refused;
  }
  if (!(await stat(cwd).catch(() => undefined))?.isDirectory()) {
    output.stderr('claude-headless: path is a folder');
    return refused;
  }
  const claudeEnv = Object.fromEntries(
    Object.entries(env).filter(
      ([name]) => !name.startsWith('CLAUDE_HEADLESS_'),
    ),
  );
  // A claude that hangs on --version doesn't run either.
  const deadline = AbortSignal.timeout(timeoutMs);
  const options = { cwd, env: claudeEnv, signal: deadline, killGraceMs };
  if ((await run(bin, ['--version'], options, noClaude)) !== 0) {
    output.stderr('claude-headless: claude does not run');
    return noClaude;
  }
  const code = await run(
    bin,
    args,
    { ...options, stdin: prompt, ...output },
    noClaude,
  );
  if (deadline.aborted) {
    output.stderr(`claude-headless: claude took longer than ${timeoutMs} ms`);
    return timedOut;
  }
  return code;
}
