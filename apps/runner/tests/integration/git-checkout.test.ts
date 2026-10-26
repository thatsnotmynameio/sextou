import { execFile, execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
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
import { createLogger } from '../../src/logger';
import { runTaskfile } from '../../src/taskfile';
import { serveGit, type GitServer } from '../git-server';
import { bin, goTask } from '../go-task';
import { memory } from '../logger';

// This repository's tasks/git/checkout: its checkout.sh run with sh, and its
// Taskfile run with runTaskfile as a claim would run it, against a git server
// on localhost instead of GitHub, over HTTPS, the only scheme it takes. The
// repository's root comes from git, since Stryker runs the suite from a copy
// of this package inside .stryker-tmp/.
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: import.meta.dirname,
  encoding: 'utf8',
}).trim();
const folder = join(root, 'tasks/git/checkout');

// The folder the git server serves, its repositories under <owner>/<name>.
let served: string;
let server: GitServer;
let dir: string;
let workspace: string;
let output: ReturnType<typeof memory>;

beforeAll(async () => {
  served = mkdtempSync(join(tmpdir(), 'sextou-served-'));
  server = await serveGit(served);
});

afterAll(async () => {
  await server.close();
  rmSync(served, { recursive: true, force: true });
});

beforeEach(() => {
  // The checkout's git, and the test's, read neither the user's nor the
  // system's configuration, whose hooks or URL rewrites would change the run,
  // and write git's messages untranslated, as the tests read them.
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('LC_ALL', 'C');
  // The git server's certificate, which no system trusts.
  vi.stubEnv('GIT_SSL_CAINFO', server.ca);
  dir = mkdtempSync(join(tmpdir(), 'sextou-checkout-'));
  workspace = join(dir, 'workspace');
  mkdirSync(workspace);
  output = memory();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
  rmSync(join(served, 'org'), { recursive: true, force: true });
});

// Runs git in `cwd` with no hooks and a fixed author.
function git(cwd: string, ...args: string[]) {
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

// org/app on the git server, with two commits on main and one more on a
// branch, which answers a fetch of any commit, as GitHub does.
function repository() {
  const path = join(served, 'org/app');
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

interface Input {
  repo?: string;
  ref?: string;
  path?: string;
  server?: string;
}

// Runs checkout.sh with sh on `input`, from the git server unless it names
// its own, into the workspace, and resolves with its exit code and stderr.
// `env` replaces variables of the environment it gets.
function script(input: Input, env: Record<string, string> = {}) {
  return new Promise<{ code: number; stderr: string }>((resolve) => {
    execFile(
      '/bin/sh',
      [join(folder, 'checkout.sh')],
      {
        env: {
          ...process.env,
          CHECKOUT_REPO: input.repo ?? '',
          CHECKOUT_REF: input.ref ?? '',
          CHECKOUT_PATH: input.path ?? '.',
          CHECKOUT_SERVER: input.server ?? server.url,
          CHECKOUT_WORKSPACE: workspace,
          ...env,
        },
      },
      (error, _stdout, stderr) => {
        resolve({ code: Number(error?.code ?? 0), stderr: stderr.trim() });
      },
    );
  });
}

test('checkout.sh checks the repository out at a commit into the workspace', async () => {
  const { first } = repository();

  expect(await script({ repo: 'org/app', ref: first })).toEqual({
    code: 0,
    stderr: '',
  });
  expect(readFileSync(join(workspace, 'file.txt'), 'utf8')).toBe('first');
  expect(git(workspace, 'rev-parse', 'HEAD')).toBe(first);
});

test('checkout.sh checks out the last commit of a branch', async () => {
  const { feature } = repository();

  await script({ repo: 'org/app', ref: 'feature' });

  expect(git(workspace, 'rev-parse', 'HEAD')).toBe(feature);
});

test('checkout.sh checks out only the ref, with no history behind it', async () => {
  repository();

  await script({ repo: 'org/app', ref: 'main' });

  expect(git(workspace, 'rev-list', '--count', 'HEAD')).toBe('1');
});

test('checkout.sh checks out into the path inside the workspace', async () => {
  repository();

  await script({ repo: 'org/app', ref: 'main', path: 'code/app' });

  expect(readdirSync(workspace)).toEqual(['code']);
  expect(readFileSync(join(workspace, 'code/app/file.txt'), 'utf8')).toBe(
    'second',
  );
});

test.each([
  ['no repo', { ref: 'main' }, 'repo is owner/name'],
  ['a repo with no owner', { repo: 'app', ref: 'main' }, 'repo is owner/name'],
  ['a repo with no name', { repo: 'org/', ref: 'main' }, 'repo is owner/name'],
  [
    'a repo with a third part',
    { repo: 'a/b/c', ref: 'main' },
    'repo is owner/name',
  ],
  ['a repo named ..', { repo: 'org/..', ref: 'main' }, 'repo is owner/name'],
  ['a repo owned by .', { repo: './app', ref: 'main' }, 'repo is owner/name'],
  [
    'a repo with a command in it',
    { repo: 'org/app; touch pwned', ref: 'main' },
    'repo is owner/name',
  ],
  [
    'a repo with a second line',
    { repo: 'org/app\nother/app', ref: 'main' },
    'repo is owner/name',
  ],
  ['no ref', { repo: 'org/app' }, 'ref is a commit, a branch or a tag'],
  [
    'a ref that is an option',
    { repo: 'org/app', ref: '--upload-pack=touch pwned' },
    'ref is a commit, a branch or a tag',
  ],
  [
    'a ref with a :',
    { repo: 'org/app', ref: 'main:refs/heads/other' },
    'ref is a commit, a branch or a tag',
  ],
  [
    'a ref with a *',
    { repo: 'org/app', ref: 'refs/heads/*' },
    'ref is a commit, a branch or a tag',
  ],
  [
    'a ref with a space',
    { repo: 'org/app', ref: 'main other' },
    'ref is a commit, a branch or a tag',
  ],
  [
    'a path that leaves the workspace',
    { repo: 'org/app', ref: 'main', path: 'code/../../out' },
    'path is inside the workspace',
  ],
  [
    'the folder above the workspace',
    { repo: 'org/app', ref: 'main', path: '..' },
    'path is inside the workspace',
  ],
  [
    'an absolute path',
    { repo: 'org/app', ref: 'main', path: '/tmp/out' },
    'path is inside the workspace',
  ],
  [
    'a server on the disk of the runner',
    { repo: 'org/app', ref: 'main', server: `file://${tmpdir()}` },
    'server is an https URL',
  ],
  [
    'a server over plain http',
    { repo: 'org/app', ref: 'main', server: 'http://127.0.0.1:1' },
    'server is an https URL',
  ],
  [
    'a server that runs a command',
    { repo: 'org/app', ref: 'main', server: 'ext::sh -c touch% pwned' },
    'server is an https URL',
  ],
])(
  'checkout.sh refuses %s with 2, before running git',
  async (_name, input, message) => {
    repository();

    expect(await script(input)).toEqual({
      code: 2,
      stderr: `checkout: ${message}`,
    });
    expect(readdirSync(workspace)).toEqual([]);
  },
);

test('checkout.sh takes a path whose segment only starts with ..', async () => {
  repository();

  expect(
    (await script({ repo: 'org/app', ref: 'main', path: '..code' })).code,
  ).toBe(0);
  expect(readdirSync(workspace)).toEqual(['..code']);
});

test('checkout.sh exits with 127 when git is not on the PATH, writing nothing', async () => {
  expect(
    await script(
      { repo: 'org/app', ref: 'main' },
      { PATH: join(dir, 'empty') },
    ),
  ).toEqual({ code: 127, stderr: 'checkout: git is not on the PATH' });
  expect(readdirSync(workspace)).toEqual([]);
});

test('checkout.sh exits with git exit code when the repository has no such ref', async () => {
  repository();

  const { code, stderr } = await script({ repo: 'org/app', ref: 'missing' });

  expect(code).toBe(128);
  expect(stderr).toBe("fatal: couldn't find remote ref missing");
});

// Runs `taskfile` with the context `input`, from the git server unless it
// names its own.
function run(
  input: Record<string, unknown>,
  taskfile = join(folder, 'Taskfile.yml'),
) {
  return runTaskfile({
    bin,
    taskfile,
    vars: {
      CONTEXT: JSON.stringify({ server: server.url, ...input }),
      WORKSPACE: workspace,
    },
    timeoutMs: 20000,
    killGraceMs: 5000,
    logger: createLogger({ level: 'info', pretty: false }, output.destination),
    signal: new AbortController().signal,
  });
}

// Each line the run wrote on `stream`.
function lines(stream: 'stdout' | 'stderr') {
  return output
    .records()
    .map((record) => record as { msg: string; stream: string; line: string })
    .filter((record) => record.msg === 'output' && record.stream === stream)
    .map(({ line }) => line);
}

goTask(
  'tasks/git/checkout checks out the repository and ref of the context into the workspace',
  async () => {
    const { first } = repository();

    expect(await run({ repo: 'org/app', ref: first })).toEqual({
      outcome: 'succeeded',
    });
    expect(git(workspace, 'rev-parse', 'HEAD')).toBe(first);
  },
);

goTask(
  'tasks/git/checkout checks out into the path of the context',
  async () => {
    repository();

    await run({ repo: 'org/app', ref: 'main', path: 'code' });

    expect(readdirSync(workspace)).toEqual(['code']);
  },
);

goTask(
  'tasks/git/checkout fails with 2 when the context has no repo',
  async () => {
    expect(await run({ ref: 'main' })).toEqual({
      outcome: 'failed',
      reason: 'exit code 2',
    });
    expect(lines('stderr')).toContain('checkout: repo is owner/name');
  },
);

goTask(
  'tasks/git/checkout fails with 2 when a value of the context is not a string',
  async () => {
    expect(await run({ repo: { owner: 'org' }, ref: 'main' })).toEqual({
      outcome: 'failed',
      reason: 'exit code 2',
    });
  },
);

goTask(
  'tasks/git/checkout checks out into the workspace when another Taskfile includes it',
  async () => {
    const { first } = repository();
    const tasks = join(dir, 'tasks');
    cpSync(join(root, 'tasks/git'), join(tasks, 'git'), { recursive: true });
    mkdirSync(join(tasks, 'build'));
    const taskfile = join(tasks, 'build/Taskfile.yml');
    writeFileSync(
      taskfile,
      [
        'version: "3"',
        'includes:',
        '  checkout: ../git/checkout',
        'tasks:',
        '  default:',
        '    cmds:',
        '      - task: checkout:default',
        '      - cat {{.WORKSPACE | q}}/file.txt',
      ].join('\n'),
    );

    expect(await run({ repo: 'org/app', ref: first }, taskfile)).toEqual({
      outcome: 'succeeded',
    });
    expect(lines('stdout')).toEqual(['first']);
  },
);
