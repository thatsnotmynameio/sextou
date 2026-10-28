import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  check,
  inputRefused,
  noGit,
  summaryRefused,
  timedOut,
} from '../../../../work-summary/check/check';
import { git, isolateGit } from '../../../repository';

// check() in this process, so coverage and Stryker see it, running git on a
// repository each test makes in its workspace: main, then a branch, work,
// whose first commit adds the plan, followed by one commit per unit with a
// Units: trailer.

let dir: string;
let workspace: string;
let repo: string;
let logged: string[];

const plan = [
  '# A plan',
  '## Implementation Units',
  '### U1. The first',
  '### U2. The second',
].join('\n');

beforeEach(() => {
  isolateGit();
  dir = mkdtempSync(join(tmpdir(), 'sextou-work-summary-'));
  workspace = join(dir, 'workspace');
  repo = join(workspace, 'repo');
  mkdirSync(repo, { recursive: true });
  logged = [];
  git(repo, 'init', '-q', '-b', 'main');
  commit({ 'README.md': 'first' }, 'first');
  git(repo, 'switch', '-q', '-c', 'work');
  commit({ 'docs/plan.md': plan }, 'docs: the plan');
  commit(
    { 'src/a.ts': 'a', 'tests/a.test.ts': 'test a' },
    'feat: a',
    'Units: U1',
  );
  commit({ 'src/b.ts': 'b' }, 'feat: b', 'Units: U2');
  write(summary());
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

// Writes `files` in the repository and commits them with `messages`.
function commit(files: Record<string, string>, ...messages: string[]) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', ...messages.flatMap((message) => ['-m', message]));
}

function run(exit_code: number) {
  return { command: 'pnpm test', exit_code, output: '' };
}

// A summary of U1 and U2 that matches the branch, changed by `fields`.
function summary(fields: Record<string, unknown> = {}) {
  return {
    status: 'complete',
    changed_files: ['src/a.ts', 'src/b.ts', 'tests/a.test.ts'],
    u_ids_attempted: ['U1', 'U2'],
    u_ids_completed: ['U1', 'U2'],
    verification: [run(0)],
    verification_evidence: [
      {
        unit: 'U1',
        behavior_changed: true,
        tests: {
          inspected: ['tests/a.test.ts'],
          added_or_changed: ['tests/a.test.ts'],
          used_unchanged: [],
        },
        red: run(1),
        verification: [run(0)],
        exception: null,
      },
      {
        unit: 'U2',
        behavior_changed: false,
        tests: { inspected: [], added_or_changed: [], used_unchanged: [] },
        red: null,
        verification: [],
        exception: null,
      },
    ],
    settled_decision_conflicts: [],
    behavior_change: true,
    blockers: [],
    ...fields,
  };
}

// Writes `value` as JSON to the summary file in the workspace.
function write(value: unknown) {
  writeFileSync(join(workspace, 'summary.json'), JSON.stringify(value));
}

// Checks the summary with a context that names the repository, main as the
// base, the plan, ignored, and the summary file, changed by `context`. `env`
// replaces variables of the environment.
function checkWith(
  context: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = {},
) {
  return check(
    {
      ...process.env,
      WORK_SUMMARY_CONTEXT: JSON.stringify({
        path: 'repo',
        base: 'main',
        plan: 'docs/plan.md',
        ignore: ['docs/plan.md'],
        summary: 'summary.json',
        ...context,
      }),
      WORK_SUMMARY_WORKSPACE: workspace,
      ...env,
    },
    (line) => logged.push(line),
  );
}

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

// A git that runs `script` with sh, and the real one with the same arguments
// after it.
function fakeGit(script: string) {
  const file = join(dir, 'fake-git');
  writeFileSync(file, `#!/bin/sh\n${script}\nexec '${gitPath()}' "$@"\n`, {
    mode: 0o755,
  });
  return file;
}

test('check takes a summary that matches the branch, the plan ignored (AE1, AE2)', async () => {
  expect(await checkWith()).toBe(0);
  expect(logged).toEqual([]);
});

test('check takes a summary of a branch whose base moved after it left', async () => {
  git(repo, 'switch', '-q', 'main');
  commit({ 'src/main.ts': 'main' }, 'feat: main');
  git(repo, 'switch', '-q', 'work');

  expect(await checkWith()).toBe(0);
  expect(logged).toEqual([]);
});

test("check refuses a recovery's summary that lists only its own new test, naming each missing file (AE1)", async () => {
  commit({ 'tests/b.test.ts': 'test b' }, 'test: b', 'Units: U1');
  write(summary({ changed_files: ['tests/b.test.ts'] }));

  expect(await checkWith()).toBe(summaryRefused);
  expect(logged).toEqual([
    'work-summary: changed_files lacks src/a.ts, which the branch changed',
    'work-summary: changed_files lacks src/b.ts, which the branch changed',
    'work-summary: changed_files lacks tests/a.test.ts, which the branch changed',
  ]);
});

test('check refuses the first commit when it changes a source file besides the ignored plan (AE2)', async () => {
  rmSync(repo, { recursive: true });
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  commit({ 'README.md': 'first' }, 'first');
  git(repo, 'switch', '-q', '-c', 'work');
  commit({ 'docs/plan.md': plan, 'src/a.ts': 'a' }, 'docs: the plan');
  commit({ 'tests/a.test.ts': 'test a' }, 'test: a', 'Units: U1');
  commit({ 'src/b.ts': 'b' }, 'feat: b', 'Units: U2');
  const sha = git(repo, 'rev-parse', '--short', 'HEAD~2');

  expect(await checkWith()).toBe(summaryRefused);
  expect(logged).toEqual([
    `work-summary: commit ${sha} (docs: the plan) names no unit of the plan in a Units: trailer`,
  ]);
});

test('check reads the Units: trailer regardless of case, several of them, and a list in one', async () => {
  commit(
    { 'src/a.ts': 'a2', 'src/b.ts': 'b2' },
    'refactor: a and b',
    'units: U1\nUNITS: U2, U1',
  );

  expect(await checkWith()).toBe(0);
});

test('check refuses a merge of the moved base into the branch, made with no Units: trailer, naming it', async () => {
  git(repo, 'switch', '-q', 'main');
  commit({ 'src/main.ts': 'main' }, 'feat: main');
  git(repo, 'switch', '-q', 'work');
  git(repo, 'merge', '-q', '--no-ff', '--no-edit', 'main');
  const sha = git(repo, 'rev-parse', '--short', 'HEAD');

  expect(await checkWith()).toBe(summaryRefused);
  expect(logged).toEqual([
    `work-summary: commit ${sha} (Merge branch 'main' into work) names no unit of the plan in a Units: trailer`,
  ]);
});

test('check refuses a summary file that does not exist', async () => {
  rmSync(join(workspace, 'summary.json'));

  expect(await checkWith()).toBe(summaryRefused);
  expect(logged).toEqual([
    `work-summary: summary: ENOENT: no such file or directory, open '${join(workspace, 'summary.json')}'`,
  ]);
});

test('check refuses a summary file that is not JSON', async () => {
  writeFileSync(join(workspace, 'summary.json'), 'done');

  expect(await checkWith()).toBe(summaryRefused);
  expect(logged).toEqual(['work-summary: summary is a JSON object']);
});

test('check gives the reasons of the form and of the branch in one answer', async () => {
  write(
    summary({ status: 'done', changed_files: ['src/a.ts', 'tests/a.test.ts'] }),
  );

  expect(await checkWith()).toBe(summaryRefused);
  expect(logged).toEqual([
    'work-summary: status is complete, blocked or failed',
    'work-summary: changed_files lacks src/b.ts, which the branch changed',
  ]);
});

test('check refuses, as the input, a plan with no unit heading', async () => {
  commit({ 'docs/plan.md': '# A plan\n\nU1 and U2.' }, 'docs: no units');

  expect(await checkWith()).toBe(inputRefused);
  expect(logged).toEqual([
    'work-summary: plan docs/plan.md has no unit heading (### U<n>. )',
  ]);
});

test('check refuses, as the input, a plan it cannot read', async () => {
  expect(await checkWith({ plan: 'docs/missing.md' })).toBe(inputRefused);
  expect(logged).toEqual([
    `work-summary: plan: ENOENT: no such file or directory, open '${join(repo, 'docs/missing.md')}'`,
  ]);
});

test('check refuses, as the input, a base that names no commit', async () => {
  expect(await checkWith({ base: 'missing' })).toBe(inputRefused);
  expect(logged).toEqual(['work-summary: base missing names no commit']);
});

test('check refuses, as the input, a base that shares no history with HEAD', async () => {
  git(repo, 'switch', '-q', '--orphan', 'other');
  commit({ 'other.txt': 'other' }, 'other');
  git(repo, 'switch', '-q', 'work');

  expect(await checkWith({ base: 'other' })).toBe(inputRefused);
  expect(logged).toEqual([
    "work-summary: base other shares no history with HEAD here: the checkout lacks the branch's history",
  ]);
});

test('check refuses, as the input, a path that holds no repository, with what git wrote', async () => {
  mkdirSync(join(workspace, 'empty'));

  expect(await checkWith({ path: 'empty' })).toBe(inputRefused);
  expect(logged.at(-1)).toBe('work-summary: git rev-parse exited with 128');
  expect(logged[0]).toMatch(/^fatal: not a git repository/);
});

test.each([
  ['diff', 'diff'],
  ['ls-tree', 'ls-tree'],
  ['log', 'log'],
])(
  'check refuses, as the input, a git %s that fails',
  async (_name, command) => {
    const bin = fakeGit(
      `[ "$1" = ${command} ] && { echo 'fatal: boom' >&2; exit 128; }`,
    );

    expect(await checkWith({}, { WORK_SUMMARY_GIT_BIN: bin })).toBe(
      inputRefused,
    );
    expect(logged).toEqual([
      'fatal: boom',
      `work-summary: git ${command} exited with 128`,
    ]);
  },
);

test("check refuses, as the input, a git diff of a commit's first parent that fails", async () => {
  const bin = fakeGit(
    `case "$*" in *'^1'*) echo 'fatal: boom' >&2; exit 128;; esac`,
  );

  expect(await checkWith({}, { WORK_SUMMARY_GIT_BIN: bin })).toBe(inputRefused);
  expect(logged).toEqual([
    'fatal: boom',
    'work-summary: git diff exited with 128',
  ]);
});

test('check refuses, as the input, a git merge-base that fails otherwise than with 1', async () => {
  const bin = fakeGit(
    `[ "$1" = merge-base ] && { echo 'fatal: boom' >&2; exit 128; }`,
  );

  expect(await checkWith({}, { WORK_SUMMARY_GIT_BIN: bin })).toBe(inputRefused);
  expect(logged).toEqual([
    'fatal: boom',
    'work-summary: git merge-base exited with 128',
  ]);
});

test('check runs the git WORK_SUMMARY_GIT_BIN names, with no PATH to find it', async () => {
  expect(
    await checkWith(
      {},
      { PATH: join(dir, 'empty'), WORK_SUMMARY_GIT_BIN: gitPath() },
    ),
  ).toBe(0);
});

test('check resolves noGit when WORK_SUMMARY_GIT_BIN names no program', async () => {
  expect(
    await checkWith({}, { WORK_SUMMARY_GIT_BIN: join(dir, 'missing') }),
  ).toBe(noGit);
  expect(logged).toEqual(['work-summary: git does not run']);
});

test('check kills git and resolves timedOut when it takes longer than WORK_SUMMARY_TIMEOUT_MS', async () => {
  const bin = join(dir, 'slow-git');
  writeFileSync(
    bin,
    '#!/bin/sh\n[ "$1" = --version ] && { echo git version 2; exit 0; }\nexec sleep 10\n',
    { mode: 0o755 },
  );
  const started = Date.now();

  expect(
    await checkWith(
      {},
      { WORK_SUMMARY_GIT_BIN: bin, WORK_SUMMARY_TIMEOUT_MS: '200' },
    ),
  ).toBe(timedOut);
  expect(logged).toEqual(['work-summary: git took longer than 200 ms']);
  expect(Date.now() - started).toBeLessThan(5000);
});

test('check removes the HOME it gave git once it ended', async () => {
  const temporary = join(dir, 'tmp');
  mkdirSync(temporary);
  vi.stubEnv('TMPDIR', temporary);

  expect(await checkWith()).toBe(0);
  expect(readdirSync(temporary)).toEqual([]);
});

test('check refuses a context readSettings refuses', async () => {
  expect(await checkWith({ base: '' })).toBe(inputRefused);
  expect(logged).toEqual(['work-summary: base is a ref']);
});

test('check refuses an environment with no context or workspace', async () => {
  expect(
    await check({ PATH: process.env.PATH }, (line) => logged.push(line)),
  ).toBe(inputRefused);
  expect(logged).toEqual(['work-summary: workspace is an absolute path']);
});

test.each([
  [
    'WORK_SUMMARY_TIMEOUT_MS',
    '10s',
    'WORK_SUMMARY_TIMEOUT_MS is a whole number of milliseconds from 1 to 2147483647',
  ],
  [
    'WORK_SUMMARY_KILL_GRACE_MS',
    '0',
    'WORK_SUMMARY_KILL_GRACE_MS is a whole number of milliseconds from 1 to 2147483647',
  ],
  [
    'WORK_SUMMARY_GIT_BIN',
    'bin/git',
    'WORK_SUMMARY_GIT_BIN is a command on the PATH or an absolute path',
  ],
])('check refuses a %s of %s', async (name, value, reason) => {
  expect(await checkWith({}, { [name]: value })).toBe(inputRefused);
  expect(logged).toEqual([`work-summary: ${reason}`]);
});

test('check refuses a path through a symlink', async () => {
  symlinkSync(repo, join(workspace, 'link'));

  expect(await checkWith({ path: 'link' })).toBe(inputRefused);
  expect(logged).toEqual(['work-summary: path is inside the workspace']);
});

test('check refuses a plan through a symlink', async () => {
  symlinkSync(join(repo, 'docs'), join(repo, 'link'));

  expect(await checkWith({ plan: 'link/plan.md' })).toBe(inputRefused);
  expect(logged).toEqual(['work-summary: plan is a path in the repository']);
});

test('check refuses a summary through a symlink', async () => {
  mkdirSync(join(dir, 'outside'));
  writeFileSync(join(dir, 'outside/summary.json'), JSON.stringify(summary()));
  symlinkSync(join(dir, 'outside'), join(workspace, 'link'));

  expect(await checkWith({ summary: 'link/summary.json' })).toBe(inputRefused);
  expect(logged).toEqual([
    'work-summary: summary is a path inside the workspace',
  ]);
});
