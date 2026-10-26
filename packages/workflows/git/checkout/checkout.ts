import { spawn } from 'node:child_process';
import { lstat, mkdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { readSettings } from './settings.ts';

// Exits with 2 on an input it refuses, having run no git and written nothing.
export const refused = 2;
// Exits with 127 when git doesn't run, having written nothing.
export const noGit = 127;

// Clones the repository the task's context names (CHECKOUT_CONTEXT, as JSON)
// into the run's workspace (CHECKOUT_WORKSPACE): a shallow fetch of that one
// ref, checked out detached. `env` is the environment git runs with, and
// `log` gets each line the checkout writes, git's included.
// Resolves with the exit code: refused, noGit, or that of the first git
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
  const { url, ref, path } = read.settings;
  if (await throughSymlink(workspace, path)) {
    log('checkout: path is inside the workspace');
    return refused;
  }
  // A repository that asks for credentials fails at once instead of waiting
  // on a prompt no one answers: no secret comes from the server.
  // Stryker disable next-line StringLiteral: git reads an empty value as false too
  const gitEnv = { ...env, GIT_TERMINAL_PROMPT: '0' };
  if ((await git(['--version'], workspace, gitEnv)) !== 0) {
    log('checkout: git does not run');
    return noGit;
  }
  await mkdir(path, { recursive: true });
  for (const args of [
    ['init', '-q'],
    ['remote', 'add', 'origin', url],
    ['fetch', '-q', '--no-tags', '--depth=1', 'origin', ref],
    ['checkout', '-q', '--force', '--detach', 'FETCH_HEAD'],
  ]) {
    const code = await git(args, path, gitEnv, log);
    if (code !== 0) {
      return code;
    }
  }
  return 0;
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

// Runs git in `cwd`, and resolves with its exit code: noGit when it doesn't
// start, 1 when a signal ended it. `log` gets each line it writes, on stdout
// or stderr; with none, they go nowhere.
function git(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  log?: (line: string) => void,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, env });
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
