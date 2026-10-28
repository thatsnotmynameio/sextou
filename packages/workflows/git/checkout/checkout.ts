import { lstat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../shared/run.ts';
import {
  defaultKillGraceMs,
  readBin,
  readTimeout,
} from '../../shared/settings.ts';
import { throughSymlink } from '../../shared/workspace.ts';
import { defaultTimeoutMs, readSettings, type Settings } from './settings.ts';

// Exits with 2 on an input it refuses, or a path it can't make a folder,
// having run no git on it and written nothing.
export const refused = 2;
// Exits with 127 when git doesn't run, having written nothing.
export const noGit = 127;
// Exits with 124 when git took longer than CHECKOUT_TIMEOUT_MS, which stops
// it, as timeout(1) does: SIGTERM, then SIGKILL once CHECKOUT_KILL_GRACE_MS
// went by.
export const timedOut = 124;

// Clones the repository the task's context names (CHECKOUT_CONTEXT, as JSON)
// into the run's workspace (CHECKOUT_WORKSPACE): a shallow fetch of that one
// ref, checked out detached. With a base, the base branch comes first, kept
// as origin/<base>, then the ref, both with their whole history, so a log
// or a diff can compare the two. `env` is the environment git runs with, and
// `log` gets each line the checkout writes, git's included. git is the
// program CHECKOUT_GIT_BIN names, a command on the PATH or an absolute path,
// git on the PATH when it is unset or empty.
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
  const timeoutMs = readTimeout(env.CHECKOUT_TIMEOUT_MS, defaultTimeoutMs);
  if (timeoutMs === undefined) {
    log(
      'checkout: CHECKOUT_TIMEOUT_MS is a whole number of milliseconds from 1 to 2147483647',
    );
    return refused;
  }
  const killGraceMs = readTimeout(
    env.CHECKOUT_KILL_GRACE_MS,
    defaultKillGraceMs,
  );
  if (killGraceMs === undefined) {
    log(
      'checkout: CHECKOUT_KILL_GRACE_MS is a whole number of milliseconds from 1 to 2147483647',
    );
    return refused;
  }
  const gitBin = readBin(env.CHECKOUT_GIT_BIN, 'git');
  if (gitBin === undefined) {
    log(
      'checkout: CHECKOUT_GIT_BIN is a command on the PATH or an absolute path',
    );
    return refused;
  }
  const { path } = read.settings;
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
  // git's HOME is an empty folder of its own, so no .netrc of the runner's
  // user hands the server a password.
  const home = await mkdtemp(join(tmpdir(), 'sextou-checkout-home-'));
  try {
    return await clone({
      env,
      gitBin,
      home,
      workspace,
      timeoutMs,
      killGraceMs,
      log,
      ...read.settings,
    });
  } finally {
    await rm(home, { recursive: true });
  }
}

async function clone({
  env,
  gitBin,
  home,
  workspace,
  timeoutMs,
  killGraceMs,
  log,
  url,
  ref,
  base,
  path,
}: Settings & {
  env: NodeJS.ProcessEnv;
  gitBin: string;
  home: string;
  workspace: string;
  timeoutMs: number;
  killGraceMs: number;
  log: (line: string) => void;
}): Promise<number> {
  // A repository that asks for credentials fails at once instead of waiting
  // on a prompt no one answers: no secret comes from the server. Nor does
  // git read the configuration of the runner's user or system, whose
  // credential helpers would hand a private repository the user's token, and
  // whose URL rewrites and hooks would change the run, nor take a setting
  // from the runner's environment: every GIT_ variable goes but the
  // certificate file git trusts, and SSH_ASKPASS, which git asks for a
  // password too, and NETRC, which names another .netrc.
  const gitEnv = {
    ...Object.fromEntries(
      Object.entries(env).filter(
        ([name]) =>
          name !== 'SSH_ASKPASS' &&
          name !== 'NETRC' &&
          (!name.startsWith('GIT_') || name === 'GIT_SSL_CAINFO'),
      ),
    ),
    HOME: home,
    // Stryker disable next-line StringLiteral: git reads an empty value as false too
    GIT_TERMINAL_PROMPT: '0',
    // Stryker disable next-line StringLiteral: git reads an empty path as no file too
    GIT_CONFIG_GLOBAL: '/dev/null',
    // Stryker disable next-line StringLiteral: git reads an empty path as no file too
    GIT_CONFIG_SYSTEM: '/dev/null',
  };
  // A git that hangs on --version doesn't run either.
  const deadline = AbortSignal.timeout(timeoutMs);
  if (
    (await run(
      gitBin,
      ['--version'],
      { cwd: workspace, env: gitEnv, signal: deadline, killGraceMs },
      noGit,
    )) !== 0
  ) {
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
  // The ref's fetch comes last, so FETCH_HEAD names it alone. A base names
  // only a branch: a tag or a commit matches no refs/heads/ on the server.
  const fetches =
    base === undefined
      ? [['fetch', '-q', '--no-tags', '--depth=1', 'origin', ref]]
      : [
          [
            'fetch',
            '-q',
            '--no-tags',
            'origin',
            `+refs/heads/${base}:refs/remotes/origin/${base}`,
          ],
          ['fetch', '-q', '--no-tags', 'origin', ref],
        ];
  for (const args of [
    ['init', '-q'],
    ['remote', 'add', 'origin', url],
    ...fetches,
    ['checkout', '-q', '--force', '--detach', 'FETCH_HEAD'],
  ]) {
    const code = await run(
      gitBin,
      args,
      {
        cwd: path,
        env: gitEnv,
        signal: deadline,
        killGraceMs,
        stdout: log,
        stderr: log,
      },
      noGit,
    );
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
