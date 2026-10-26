import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
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
import { createServer, type Socket } from 'node:net';
import {
  checkout,
  noGit,
  refused,
  timedOut,
} from '../../../../git/checkout/checkout';
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
  server.credentials.length = 0;
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

test('checkout refuses a path where a file is, running no git on it', async () => {
  repository(served);
  writeFileSync(join(workspace, 'code'), '');

  expect(await run({ repo: 'org/app', ref: 'main', path: 'code' })).toBe(
    refused,
  );
  expect(logged).toEqual([
    `checkout: EEXIST: file already exists, mkdir '${join(workspace, 'code')}'`,
  ]);
});

// A configuration that sends a fetch of org/app to org/missing.
function rewrite() {
  const file = join(dir, 'gitconfig');
  writeFileSync(
    file,
    `[url "${server.url}/org/missing"]\n\tinsteadOf = ${server.url}/org/app\n`,
  );
  return file;
}

test.each([
  ['user', () => ({ GIT_CONFIG_GLOBAL: rewrite() })],
  ['system', () => ({ GIT_CONFIG_SYSTEM: rewrite(), GIT_CONFIG_NOSYSTEM: '' })],
  [
    'environment, in GIT_CONFIG_PARAMETERS',
    () => ({
      GIT_CONFIG_PARAMETERS: `'url.${server.url}/org/missing.insteadof'='${server.url}/org/app'`,
    }),
  ],
  [
    'environment, in GIT_CONFIG_COUNT',
    () => ({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.${server.url}/org/missing.insteadOf`,
      GIT_CONFIG_VALUE_0: `${server.url}/org/app`,
    }),
  ],
])("checkout reads no configuration of the runner's %s", async (_name, env) => {
  repository(served);

  expect(await run({ repo: 'org/app', ref: 'main' }, env())).toBe(0);
});

test('checkout checks out into the workspace whatever GIT_DIR the runner has', async () => {
  repository(served);
  const elsewhere = join(dir, 'elsewhere');

  expect(
    await run({ repo: 'org/app', ref: 'main' }, { GIT_DIR: elsewhere }),
  ).toBe(0);
  expect(readFileSync(join(workspace, 'file.txt'), 'utf8')).toBe('second');
  expect(existsSync(elsewhere)).toBe(false);
});

test.each(['GIT_ASKPASS', 'SSH_ASKPASS'])(
  "checkout asks no password of the runner's %s for a repository that wants one",
  async (name) => {
    const asked = join(dir, 'asked');
    const askpass = join(dir, 'askpass');
    writeFileSync(askpass, `#!/bin/sh\ntouch '${asked}'\necho secret\n`, {
      mode: 0o755,
    });

    expect(
      await run({ repo: 'org/private', ref: 'main' }, { [name]: askpass }),
    ).toBe(128);
    expect(existsSync(asked)).toBe(false);
    expect(server.credentials).toEqual([]);
  },
);

// A .netrc in `folder` with a password for the git server.
function netrc(folder: string) {
  mkdirSync(folder, { recursive: true });
  const file = join(folder, '.netrc');
  writeFileSync(file, 'machine 127.0.0.1 login runner password secret\n', {
    mode: 0o600,
  });
  return file;
}

test("checkout sends the server no password of the .netrc in the runner's HOME", async () => {
  const home = join(dir, 'home');
  netrc(home);

  expect(await run({ repo: 'org/private', ref: 'main' }, { HOME: home })).toBe(
    128,
  );
  expect(server.credentials).toEqual([]);
});

test('checkout sends the server no password of the .netrc NETRC names', async () => {
  expect(
    await run(
      { repo: 'org/private', ref: 'main' },
      { NETRC: netrc(join(dir, 'other')) },
    ),
  ).toBe(128);
  expect(server.credentials).toEqual([]);
});

test('checkout removes the HOME it gave git once it ended', async () => {
  repository(served);
  const temporary = join(dir, 'tmp');
  mkdirSync(temporary);
  vi.stubEnv('TMPDIR', temporary);

  expect(await run({ repo: 'org/app', ref: 'main' })).toBe(0);
  expect(readdirSync(temporary)).toEqual([]);
});

test('checkout resolves noGit when git does not run, writing nothing', async () => {
  expect(
    await run({ repo: 'org/app', ref: 'main' }, { PATH: join(dir, 'empty') }),
  ).toBe(noGit);
  expect(logged).toEqual(['checkout: git does not run']);
  expect(readdirSync(workspace)).toEqual([]);
});

// The path of the git on the PATH.
function gitPath() {
  const found = (process.env.PATH ?? '')
    .split(':')
    .map((folder) => join(folder, 'git'))
    .find((path) => existsSync(path));
  if (found === undefined) {
    throw new Error('no git on the PATH');
  }
  return found;
}

test('checkout runs the git CHECKOUT_GIT_BIN names, with no PATH to find it', async () => {
  const { first } = repository(served);

  expect(
    await run(
      { repo: 'org/app', ref: first },
      { PATH: join(dir, 'empty'), CHECKOUT_GIT_BIN: gitPath() },
    ),
  ).toBe(0);
  expect(git(workspace, 'rev-parse', 'HEAD')).toBe(first);
});

test('checkout resolves noGit when CHECKOUT_GIT_BIN names no program, writing nothing', async () => {
  expect(
    await run(
      { repo: 'org/app', ref: 'main' },
      { CHECKOUT_GIT_BIN: join(dir, 'missing') },
    ),
  ).toBe(noGit);
  expect(logged).toEqual(['checkout: git does not run']);
  expect(readdirSync(workspace)).toEqual([]);
});

test('checkout runs git from the PATH when CHECKOUT_GIT_BIN is empty', async () => {
  const { first } = repository(served);

  expect(
    await run({ repo: 'org/app', ref: first }, { CHECKOUT_GIT_BIN: '' }),
  ).toBe(0);
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

test('checkout refuses a second checkout into the same path, leaving the first as it was', async () => {
  const { first } = repository(served);
  await run({ repo: 'org/app', ref: first });

  expect(await run({ repo: 'org/app', ref: 'feature' })).toBe(refused);
  expect(logged).toContain('checkout: path holds a repository already');
  expect(git(workspace, 'rev-parse', 'HEAD')).toBe(first);
});

test('checkout takes a second checkout into another path', async () => {
  const { first, feature } = repository(served);
  await run({ repo: 'org/app', ref: first, path: 'one' });

  expect(await run({ repo: 'org/app', ref: 'feature', path: 'two' })).toBe(0);
  expect(git(join(workspace, 'two'), 'rev-parse', 'HEAD')).toBe(feature);
});

test('checkout refuses a CHECKOUT_TIMEOUT_MS that is not a number of milliseconds, writing nothing', async () => {
  expect(
    await run({ repo: 'org/app', ref: 'main' }, { CHECKOUT_TIMEOUT_MS: '10s' }),
  ).toBe(refused);
  expect(logged).toEqual([
    'checkout: CHECKOUT_TIMEOUT_MS is a whole number of milliseconds from 1 to 2147483647',
  ]);
  expect(readdirSync(workspace)).toEqual([]);
});

test('checkout kills git and resolves timedOut when it takes longer than CHECKOUT_TIMEOUT_MS', async () => {
  // A server that takes the connection and never answers.
  const sockets: Socket[] = [];
  const silent = createServer((socket) => sockets.push(socket));
  silent.listen(0, '127.0.0.1');
  await new Promise((resolve) => silent.once('listening', resolve));
  const { port } = silent.address() as { port: number };
  const started = Date.now();

  const code = await run(
    { repo: 'org/app', ref: 'main', server: `https://127.0.0.1:${port}` },
    { CHECKOUT_TIMEOUT_MS: '500' },
  );

  for (const socket of sockets) {
    socket.destroy();
  }
  silent.close();
  expect(code).toBe(timedOut);
  expect(logged).toContain('checkout: git took longer than 500 ms');
  expect(Date.now() - started).toBeLessThan(5000);
});
