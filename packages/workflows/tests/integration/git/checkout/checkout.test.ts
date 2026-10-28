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
  inject,
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
import { git, isolateGit } from '../../../repository';

// checkout() in this process, so coverage and Stryker see it, running git
// against a git server on localhost over HTTPS, the only scheme it takes.

// The repository tests/repository.ts made for this Vitest instance, under
// the folder the git server serves.
const served = inject('served');
let server: GitServer;
let dir: string;
let workspace: string;
let logged: string[];

beforeAll(async () => {
  server = await serveGit(served.root);
});

afterAll(async () => {
  await server.close();
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
  const { first } = served;

  expect(await run({ repo: 'org/app', ref: first })).toBe(0);
  expect(readFileSync(join(workspace, 'file.txt'), 'utf8')).toBe('first');
  expect(git(workspace, 'rev-parse', 'HEAD')).toBe(first);
});

test('checkout checks out the last commit of a branch', async () => {
  const { feature } = served;

  await run({ repo: 'org/app', ref: 'feature' });

  expect(git(workspace, 'rev-parse', 'HEAD')).toBe(feature);
});

test('checkout leaves HEAD detached', async () => {
  await run({ repo: 'org/app', ref: 'main' });

  expect(git(workspace, 'branch', '--show-current')).toBe('');
});

test('checkout fetches only the ref, with no history behind it', async () => {
  await run({ repo: 'org/app', ref: 'main' });

  expect(git(workspace, 'rev-list', '--count', 'HEAD')).toBe('1');
});

test('checkout fetches no tag', async () => {
  await run({ repo: 'org/app', ref: 'main' });

  expect(git(workspace, 'tag')).toBe('');
});

test('checkout with a base logs only the commits the ref added to it', async () => {
  const { feature } = served;

  expect(await run({ repo: 'org/app', ref: 'feature', base: 'main' })).toBe(0);
  expect(git(workspace, 'log', '--format=%H', 'origin/main..HEAD')).toBe(
    feature,
  );
});

test('checkout with a base diffs the ref from where it left the base', async () => {
  await run({ repo: 'org/app', ref: 'feature', base: 'main' });

  expect(git(workspace, 'diff', '--name-only', 'origin/main...HEAD')).toBe(
    'file.txt',
  );
});

test('checkout with a base keeps it as origin/<base> at its last commit', async () => {
  await run({ repo: 'org/app', ref: 'feature', base: 'main' });

  expect(git(workspace, 'log', '-1', '--format=%s', 'origin/main')).toBe(
    'main',
  );
});

test('checkout with a base checks the ref out detached', async () => {
  const { feature } = served;

  await run({ repo: 'org/app', ref: 'feature', base: 'main' });

  expect(git(workspace, 'rev-parse', 'HEAD')).toBe(feature);
  expect(git(workspace, 'branch', '--show-current')).toBe('');
});

test('checkout with a base fetches the whole history of the ref', async () => {
  await run({ repo: 'org/app', ref: 'feature', base: 'main' });

  expect(git(workspace, 'rev-list', '--count', 'HEAD')).toBe('3');
});

test('checkout with a base fetches no other ref and no tag', async () => {
  await run({ repo: 'org/app', ref: 'feature', base: 'main' });

  expect(git(workspace, 'for-each-ref', '--format=%(refname)')).toBe(
    'refs/remotes/origin/feature\nrefs/remotes/origin/main',
  );
});

test('checkout takes the base as the ref, with nothing to log or diff', async () => {
  expect(await run({ repo: 'org/app', ref: 'main', base: 'main' })).toBe(0);
  expect(git(workspace, 'log', 'origin/main..HEAD')).toBe('');
  expect(git(workspace, 'diff', 'origin/main...HEAD')).toBe('');
});

test('checkout with a base checks out a ref that is a commit', async () => {
  const { first } = served;

  expect(await run({ repo: 'org/app', ref: first, base: 'main' })).toBe(0);
  expect(git(workspace, 'rev-parse', 'HEAD')).toBe(first);
});

test.each([
  ['a branch the server lacks', 'release'],
  ['a tag', 'v1'],
])(
  'checkout resolves git exit code for a base that is %s, checking nothing out',
  async (_name, base) => {
    expect(await run({ repo: 'org/app', ref: 'feature', base })).toBe(128);
    expect(existsSync(join(workspace, 'file.txt'))).toBe(false);
  },
);

test('checkout checks out into the path inside the workspace', async () => {
  await run({ repo: 'org/app', ref: 'main', path: 'code/app' });

  expect(readdirSync(workspace)).toEqual(['code']);
  expect(readFileSync(join(workspace, 'code/app/file.txt'), 'utf8')).toBe(
    'second',
  );
});

test('checkout points origin at the repository', async () => {
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
  symlinkSync(join(dir, 'outside'), join(workspace, 'link'));

  expect(await run({ repo: 'org/app', ref: 'main', path: 'code' })).toBe(0);
});

test('checkout refuses a path where a file is, running no git on it', async () => {
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
  expect(await run({ repo: 'org/app', ref: 'main' }, env())).toBe(0);
});

test('checkout checks out into the workspace whatever GIT_DIR the runner has', async () => {
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
  const { first } = served;

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
  const { first } = served;

  expect(
    await run({ repo: 'org/app', ref: first }, { CHECKOUT_GIT_BIN: '' }),
  ).toBe(0);
});

test('checkout resolves git exit code when the repository has no such ref', async () => {
  expect(await run({ repo: 'org/app', ref: 'missing' })).toBe(128);
  expect(git(workspace, 'rev-parse', '--is-inside-work-tree')).toBe('true');
});

test('checkout logs each line git writes', async () => {
  await run({ repo: 'org/app', ref: 'missing' });

  expect(logged).toContain("fatal: couldn't find remote ref missing");
});

test('checkout logs nothing of the version check', async () => {
  await run({ repo: 'org/app', ref: 'main' });

  expect(logged.filter((line) => line.startsWith('git version'))).toEqual([]);
});

test('checkout resolves git exit code when the server has no such repository', async () => {
  expect(await run({ repo: 'org/missing', ref: 'main' })).toBe(128);
});

test('checkout refuses a second checkout into the same path, leaving the first as it was', async () => {
  const { first } = served;
  await run({ repo: 'org/app', ref: first });

  expect(await run({ repo: 'org/app', ref: 'feature' })).toBe(refused);
  expect(logged).toContain('checkout: path holds a repository already');
  expect(git(workspace, 'rev-parse', 'HEAD')).toBe(first);
});

test('checkout takes a second checkout into another path', async () => {
  const { first, feature } = served;
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

test('checkout refuses a CHECKOUT_KILL_GRACE_MS that is not a number of milliseconds', async () => {
  expect(
    await run(
      { repo: 'org/app', ref: 'main' },
      { CHECKOUT_KILL_GRACE_MS: '0' },
    ),
  ).toBe(refused);
  expect(logged).toEqual([
    'checkout: CHECKOUT_KILL_GRACE_MS is a whole number of milliseconds from 1 to 2147483647',
  ]);
});

test('checkout refuses a CHECKOUT_GIT_BIN that is a relative path, which would resolve in the workspace', async () => {
  expect(
    await run(
      { repo: 'org/app', ref: 'main' },
      { CHECKOUT_GIT_BIN: 'bin/git' },
    ),
  ).toBe(refused);
  expect(logged).toEqual([
    'checkout: CHECKOUT_GIT_BIN is a command on the PATH or an absolute path',
  ]);
});

test.each([
  ['without a base', {}],
  ['with a base', { base: 'main' }],
])(
  'checkout %s kills git and resolves timedOut when it takes longer than CHECKOUT_TIMEOUT_MS',
  async (_name, fields) => {
    // A server that takes the connection and never answers.
    const sockets: Socket[] = [];
    const silent = createServer((socket) => sockets.push(socket));
    silent.listen(0, '127.0.0.1');
    await new Promise((resolve) => silent.once('listening', resolve));
    const { port } = silent.address() as { port: number };
    const started = Date.now();

    const code = await run(
      {
        repo: 'org/app',
        ref: 'main',
        server: `https://127.0.0.1:${port}`,
        ...fields,
      },
      { CHECKOUT_TIMEOUT_MS: '200' },
    );

    for (const socket of sockets) {
      socket.destroy();
    }
    silent.close();
    expect(code).toBe(timedOut);
    expect(logged).toContain('checkout: git took longer than 200 ms');
    expect(Date.now() - started).toBeLessThan(5000);
  },
);

test('checkout with a base gives both fetches one CHECKOUT_TIMEOUT_MS between them', async () => {
  // A git that takes 3 s over the base's fetch, then never ends the ref's.
  const slow = join(dir, 'git');
  writeFileSync(
    slow,
    '#!/bin/sh\ncase "$*" in\n  *refs/heads/main:*) sleep 3 ;;\n  fetch*) exec sleep 60 ;;\nesac\nexec git "$@"\n',
    { mode: 0o755 },
  );
  const started = Date.now();

  const code = await run(
    { repo: 'org/app', ref: 'feature', base: 'main' },
    { CHECKOUT_GIT_BIN: slow, CHECKOUT_TIMEOUT_MS: '5000' },
  );

  expect(code).toBe(timedOut);
  expect(logged).toContain('checkout: git took longer than 5000 ms');
  expect(git(workspace, 'log', '-1', '--format=%s', 'origin/main')).toBe(
    'main',
  );
  // A deadline of its own for the ref's fetch would end past 8 s.
  expect(Date.now() - started).toBeLessThan(7000);
}, 20_000);
