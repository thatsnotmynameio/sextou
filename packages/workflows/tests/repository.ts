import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    // The folder the git servers serve, org/app under it, and its commits.
    served: { root: string; first: string; feature: string };
  }
}

// What keeps git, the test's and the checkout's, from reading the user's or
// the system's configuration, whose hooks or URL rewrites would change a run,
// and has it write its messages untranslated, as the tests read them.
const isolated = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  LC_ALL: 'C',
};

// Stubs the variables that keep git from the user's configuration, until
// vi.unstubAllEnvs().
export function isolateGit() {
  for (const [name, value] of Object.entries(isolated)) {
    vi.stubEnv(name, value);
  }
}

// Runs git in `cwd` with no hooks, a fixed author and none of the user's
// configuration.
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
    { cwd, encoding: 'utf8', env: { ...process.env, ...isolated } },
  ).trim();
}

// org/app under `root`, with two commits on main, tagged v1, and one more on
// a branch, which answers a fetch of any commit, as GitHub does.
function repository(root: string) {
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
  git(path, 'tag', 'v1');
  git(path, 'switch', '-q', '-c', 'feature');
  writeFileSync(join(path, 'file.txt'), 'feature');
  git(path, 'commit', '-q', '-a', '-m', 'feature');
  const feature = git(path, 'rev-parse', 'HEAD');
  git(path, 'switch', '-q', 'main');
  return { first, feature };
}

/**
 * The integration suite's global setup: makes org/app once per Vitest
 * instance and hands its folder and commits to the tests as `served`. Stryker
 * keeps one instance per worker and runs a test file again for each mutant,
 * so the repository is made once per worker instead of once per test of each
 * run. Every test only fetches from it, so none changes what another sees.
 * @param project the project the tests inject the repository from
 * @returns the teardown, which removes the folder
 */
export default function setup(project: TestProject) {
  const root = mkdtempSync(join(tmpdir(), 'sextou-served-'));
  try {
    project.provide('served', { root, ...repository(root) });
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  return () => rmSync(root, { recursive: true, force: true });
}
