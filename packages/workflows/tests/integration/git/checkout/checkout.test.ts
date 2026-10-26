import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest';
import { checkout, noGit, refused } from '../../../../git/checkout/checkout';
import { serveGit, type GitServer } from '../../../git-server';
import { git, isolateGit, repository } from '../../../repository';

// checkout() in this process, so coverage and Stryker see it, running git
// against a git server on localhost over HTTPS, the only scheme it takes.

// The folder the git server serves, its repositories under <owner>/<name>.
let served: string;
let server: GitServer;
let dir: string;
let workspace: string;
let logged: string[];

beforeAll(async () => {
  served = mkdtempSync(join(tmpdir(), 'sextou-served-'));
  server = await serveGit(served);
});

afterAll(async () => {
  await server.close();
  rmSync(served, { recursive: true, force: true });
});

beforeEach(() => {
  isolateGit();
  dir = mkdtempSync(join(tmpdir(), 'sextou-checkout-'));
  workspace = join(dir, 'workspace');
  mkdirSync(workspace);
  logged = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
  rmSync(join(served, 'org'), { recursive: true, force: true });
});

// Checks out `context`, from the git server unless it names its own, into
// the workspace. `env` replaces variables of the environment git gets.
function run(context: Record<string, unknown>, env: NodeJS.ProcessEnv = {}) {
  return checkout(
    {
      ...process.env,
      // The git server's certificate, which no system trusts.
      GIT_SSL_CAINFO: server.ca,
      CHECKOUT_CONTEXT: JSON.stringify({ server: server.url, ...context }),
      CHECKOUT_WORKSPACE: workspace,
      ...env,
    },
    (line) => logged.push(line),
  );
}

test('checkout checks the repository out at a commit into the workspace', async () => {
  const { first } = repository(served);

  expect(await run({ repo: 'org/app', ref: first })).toBe(0);
  expect(readFileSync(join(workspace, 'file.txt'), 'utf8')).toBe('first');
  expect(git(workspace, 'rev-parse', 'HEAD')).toBe(first);
});

test('checkout checks out the last commit of a branch', async () => {
  const { feature } = repository(served);

  await run({ repo: 'org/app', ref: 'feature' });

  expect(git(workspace, 'rev-parse', 'HEAD')).toBe(feature);
});

test('checkout leaves HEAD detached', async () => {
  repository(served);

  await run({ repo: 'org/app', ref: 'main' });

  expect(git(workspace, 'branch', '--show-current')).toBe('');
});

test('checkout fetches only the ref, with no history behind it', async () => {
  repository(served);

  await run({ repo: 'org/app', ref: 'main' });

  expect(git(workspace, 'rev-list', '--count', 'HEAD')).toBe('1');
});

test('checkout fetches no tag', async () => {
  repository(served);
  git(join(served, 'org/app'), 'tag', 'v1');

  await run({ repo: 'org/app', ref: 'main' });

  expect(git(workspace, 'tag')).toBe('');
});

test('checkout checks out into the path inside the workspace', async () => {
  repository(served);

  await run({ repo: 'org/app', ref: 'main', path: 'code/app' });

  expect(readdirSync(workspace)).toEqual(['code']);
  expect(readFileSync(join(workspace, 'code/app/file.txt'), 'utf8')).toBe(
    'second',
  );
});

test('checkout points origin at the repository', async () => {
  repository(served);

  await run({ repo: 'org/app', ref: 'main' });

  expect(git(workspace, 'remote', 'get-url', 'origin')).toBe(
    `${server.url}/org/app`,
  );
});

test('checkout refuses a context readSettings refuses, writing nothing', async () => {
  expect(await run({ repo: 'org/..', ref: 'main' })).toBe(refused);
  expect(logged).toEqual(['checkout: repo is owner/name']);
  expect(readdirSync(workspace)).toEqual([]);
});

test('checkout refuses a context that is not JSON', async () => {
  expect(await run({}, { CHECKOUT_CONTEXT: 'org/app' })).toBe(refused);
  expect(logged).toEqual(['checkout: context is a JSON object']);
});

test('checkout refuses an environment with no context or workspace', async () => {
  expect(
    await checkout({ PATH: process.env.PATH }, (line) => logged.push(line)),
  ).toBe(refused);
  expect(logged).toEqual(['checkout: workspace is an absolute path']);
});

test.each(['link', 'link/app', 'code/link/app'])(
  'checkout refuses the path %s through a symlink out of the workspace, writing nothing',
  async (path) => {
    repository(served);
    const outside = join(dir, 'outside');
    mkdirSync(outside);
    mkdirSync(join(workspace, 'code'));
    symlinkSync(outside, join(workspace, 'link'));
    symlinkSync(outside, join(workspace, 'code/link'));

    expect(await run({ repo: 'org/app', ref: 'main', path })).toBe(refused);
    expect(logged).toEqual(['checkout: path is inside the workspace']);
    expect(readdirSync(outside)).toEqual([]);
  },
);

test('checkout takes a path beside a symlink', async () => {
  repository(served);
  symlinkSync(join(dir, 'outside'), join(workspace, 'link'));

  expect(await run({ repo: 'org/app', ref: 'main', path: 'code' })).toBe(0);
});

test('checkout resolves noGit when git does not run, writing nothing', async () => {
  expect(
    await run({ repo: 'org/app', ref: 'main' }, { PATH: join(dir, 'empty') }),
  ).toBe(noGit);
  expect(logged).toEqual(['checkout: git does not run']);
  expect(readdirSync(workspace)).toEqual([]);
});

test('checkout resolves git exit code when the repository has no such ref', async () => {
  repository(served);

  expect(await run({ repo: 'org/app', ref: 'missing' })).toBe(128);
  expect(git(workspace, 'rev-parse', '--is-inside-work-tree')).toBe('true');
});

test('checkout logs each line git writes', async () => {
  repository(served);

  await run({ repo: 'org/app', ref: 'missing' });

  expect(logged).toContain("fatal: couldn't find remote ref missing");
});

test('checkout logs nothing of the version check', async () => {
  repository(served);

  await run({ repo: 'org/app', ref: 'main' });

  expect(logged.filter((line) => line.startsWith('git version'))).toEqual([]);
});

test('checkout resolves git exit code when the server has no such repository', async () => {
  expect(await run({ repo: 'org/missing', ref: 'main' })).toBe(128);
});
