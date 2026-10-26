import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';

// Keeps git, the test's and the checkout's, from reading the user's or the
// system's configuration, whose hooks or URL rewrites would change a run,
// and has it write its messages untranslated, as the tests read them. The
// stubs last until vi.unstubAllEnvs().
export function isolateGit() {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('LC_ALL', 'C');
}

// Runs git in `cwd` with no hooks and a fixed author.
export function git(cwd: string, ...args: string[]) {
  return execFileSync(
    'git',
    [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'user.name=sextou',
      '-c',
      'user.email=sextou@example.com',
      ...args,
    ],
    { cwd, encoding: 'utf8' },
  ).trim();
}

// org/app under `root`, with two commits on main and one more on a branch,
// which answers a fetch of any commit, as GitHub does.
export function repository(root: string) {
  const path = join(root, 'org/app');
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q', '-b', 'main');
  git(path, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  writeFileSync(join(path, 'file.txt'), 'first');
  git(path, 'add', 'file.txt');
  git(path, 'commit', '-q', '-m', 'first');
  const first = git(path, 'rev-parse', 'HEAD');
  writeFileSync(join(path, 'file.txt'), 'second');
  git(path, 'commit', '-q', '-a', '-m', 'second');
  git(path, 'switch', '-q', '-c', 'feature');
  writeFileSync(join(path, 'file.txt'), 'feature');
  git(path, 'commit', '-q', '-a', '-m', 'feature');
  const feature = git(path, 'rev-parse', 'HEAD');
  git(path, 'switch', '-q', 'main');
  return { first, feature };
}
