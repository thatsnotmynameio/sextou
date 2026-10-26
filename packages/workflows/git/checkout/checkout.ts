import { spawn } from 'node:child_process';
import { lstat, mkdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { readSettings, readTimeout } from './settings.ts';

// Exits with 2 on an input it refuses, or a path it can't make a folder,
// having run no git on it and written nothing.
export const refused = 2;
// Exits with 127 when git doesn't run, having written nothing.
export const noGit = 127;
// Exits with 124 when git took longer than CHECKOUT_TIMEOUT_MS, which kills
// it, as timeout(1) does.
export const timedOut = 124;

// Clones the repository the task's context names (CHECKOUT_CONTEXT, as JSON)
// into the run's workspace (CHECKOUT_WORKSPACE): a shallow fetch of that one
// ref, checked out detached. `env` is the environment git runs with, and
// `log` gets each line the checkout writes, git's included.
// Resolves with the exit code: refused, noGit, timedOut, or that of the first git
// command that failed, else 0.
export async function checkout(
  env: NodeJS.ProcessEnv,
  log: (line: string) => void,
): Promise<number> {
  // Stryker disable next-line StringLiteral: any path but an absolute one refuses the same
  const workspace = env.CHECKOUT_WORKSPACE ?? '';
  // Stryker disable next-line StringLiteral: any text but JSON refuses the same
  const read = readSettings(env.CHECKOUT_CONTEXT ?? '', workspace);
  if (!read.ok) {
    log(`checkout: ${read.reason}`);
    return refused;
  }
  const timeoutMs = readTimeout(env.CHECKOUT_TIMEOUT_MS);
  if (timeoutMs === undefined) {
    log(
      'checkout: CHECKOUT_TIMEOUT_MS is a whole number of milliseconds from 1 to 2147483647',
    );
    return refused;
  }
  const { url, ref, path } = read.settings;
  if (await throughSymlink(workspace, path)) {
    log('checkout: path is inside the workspace');
    return refused;
  }
  // One checkout per folder: a second one into the same path would find the
  // first's origin, and check out over its files.
  if (await exists(join(path, '.git'))) {
    log('checkout: path holds a repository already');
    return refused;
  }
  // A repository that asks for credentials fails at once instead of waiting
  // on a prompt no one answers: no secret comes from the server. Nor does
  // git read the configuration of the runner's user or system, whose
  // credential helpers would hand a private repository the user's token, and
  // whose URL rewrites and hooks would change the run.
  const gitEnv = {
    ...env,
    // Stryker disable next-line StringLiteral: git reads an empty value as false too
    GIT_TERMINAL_PROMPT: '0',
    // Stryker disable next-line StringLiteral: git reads an empty path as no file too
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  // A git that hangs on --version doesn't run either.
  const deadline = AbortSignal.timeout(timeoutMs);
  if ((await git(['--version'], workspace, gitEnv, deadline)) !== 0) {
    log('checkout: git does not run');
    return noGit;
  }
  // A file where the path names a folder, say.
  try {
    await mkdir(path, { recursive: true });
  } catch (error) {
    log(`checkout: ${(error as Error).message}`);
    return refused;
  }
  for (const args of [
    ['init', '-q'],
    ['remote', 'add', 'origin', url],
    ['fetch', '-q', '--no-tags', '--depth=1', 'origin', ref],
    ['checkout', '-q', '--force', '--detach', 'FETCH_HEAD'],
  ]) {
    const code = await git(args, path, gitEnv, deadline, log);
    if (deadline.aborted) {
      log(`checkout: git took longer than ${timeoutMs} ms`);
      return timedOut;
    }
    if (code !== 0) {
      return code;
    }
  }
  return 0;
}

async function exists(path: string) {
  return (await lstat(path).catch(() => undefined)) !== undefined;
}

// Whether `path` goes through a symlink below the workspace, as one an
// earlier checkout into it left, which would lead mkdir and git out of it.
async function throughSymlink(workspace: string, path: string) {
  let current = workspace;
  for (const name of relative(workspace, path).split(sep)) {
    current = join(current, name);
    const stats = await lstat(current).catch(() => undefined);
    if (stats === undefined) {
      return false;
    }
    if (stats.isSymbolicLink()) {
      return true;
    }
  }
  return false;
}

// Runs git in `cwd` until `signal` aborts, which kills it, and resolves with
// its exit code: noGit when it doesn't start or was killed, 1 when another
// signal ended it. `log` gets each line it writes, on stdout or stderr; with
// none, they go nowhere.
function git(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  log?: (line: string) => void,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, env, signal });
    for (const input of [child.stdout, child.stderr]) {
      createInterface({ input, crlfDelay: Infinity }).on('line', (line) =>
        log?.(line),
      );
    }
    // Stryker disable next-line ArrowFunction: close follows, with a negative code, which ends the same
    child.on('error', () => resolve(noGit));
    child.on('close', (code) => resolve(code ?? 1));
  });
}
