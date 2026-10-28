import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  type Harness,
  notRun,
  refused,
  runHarness,
  timedOut,
} from '../../../../harness/agnostic-cli/run';
import { received, writeFakeClaude } from '../../../fake-claude';

// runHarness() in this process, so coverage and Stryker see it, running a
// harness of the test's own, whose program is the fake claude: a program
// that records what it got, whatever agent CLI it stands for.

let dir: string;
let workspace: string;
let program: string;
let file: string;
let stdout: string[];
let stderr: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-agnostic-cli-'));
  workspace = join(dir, 'workspace');
  mkdirSync(workspace);
  program = writeFakeClaude(dir);
  file = join(dir, 'received.json');
  stdout = [];
  stderr = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// A harness named fake-harness for an agent CLI named fake, which runs the
// program with `run` and the context's `flag`, changed by `changes`.
function harness(changes: Partial<Harness> = {}): Harness {
  return {
    name: 'fake-harness',
    program: 'fake',
    ownVariables: 'FAKE_HARNESS_',
    prepare: (fields) => ({
      ok: true,
      bin: program,
      args: ['run', `--flag=${String(fields.flag)}`],
      timeoutMs: 60_000,
      killGraceMs: 1_000,
    }),
    ...changes,
  };
}

// Runs `harness` for `context` in the workspace, with `env` over the
// process's environment, and resolves with the exit code.
function run(
  context: Record<string, unknown> | string,
  changes: Partial<Harness> = {},
  env: NodeJS.ProcessEnv = {},
) {
  return runHarness(
    harness(changes),
    {
      context: typeof context === 'string' ? context : JSON.stringify(context),
      workspace,
      env: { ...process.env, FAKE_CLAUDE_RECEIVED: file, ...env },
    },
    {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    },
  );
}

test('runHarness hands the program the prompt on its stdin', async () => {
  await run({ prompt: 'fix the build' });

  expect(received(file).stdin).toBe('fix the build');
});

test('runHarness runs the program with the arguments the harness prepared from the context', async () => {
  await run({ prompt: 'hi', flag: 'on' });

  expect(received(file).args).toEqual(['run', '--flag=on']);
});

test('runHarness runs the program in the path of the context', async () => {
  mkdirSync(join(workspace, 'code'));

  await run({ prompt: 'hi', path: 'code' });

  expect(received(file).cwd).toBe(join(workspace, 'code'));
});

test("runHarness keeps the harness's own variables from the program", async () => {
  await run(
    { prompt: 'hi' },
    {},
    { FAKE_HARNESS_TIMEOUT_MS: '1000', SEXTOU_TEST_MARKER: 'set' },
  );

  expect(
    received(file).env.filter(
      (name) =>
        name.startsWith('FAKE_HARNESS_') || name === 'SEXTOU_TEST_MARKER',
    ),
  ).toEqual(['SEXTOU_TEST_MARKER']);
});

test('runHarness hands on each line the program writes, by its stream', async () => {
  await run({ prompt: 'hi' });

  expect({ stdout, stderr }).toEqual({
    stdout: ['first line', 'second line'],
    stderr: ['a warning'],
  });
});

test('runHarness exits with the exit code of the program', async () => {
  expect(await run({ prompt: 'hi' }, {}, { FAKE_CLAUDE_EXIT: '3' })).toBe(3);
});

test("runHarness refuses a context it can't read under the harness's name", async () => {
  expect(await run('[]')).toBe(refused);
  expect(stderr).toEqual(['fake-harness: context is a JSON object']);
});

test("runHarness refuses with the harness's reason when the harness refuses the context", async () => {
  const code = await run(
    { prompt: 'hi' },
    { prepare: () => ({ ok: false, reason: 'flag is on or off' }) },
  );

  expect({ code, stderr, ran: existsSync(file) }).toEqual({
    code: refused,
    stderr: ['fake-harness: flag is on or off'],
    ran: false,
  });
});

test('runHarness reports a context it refuses before a refusal of the harness', async () => {
  await run(
    { prompt: '' },
    { prepare: () => ({ ok: false, reason: 'flag is on or off' }) },
  );

  expect(stderr).toEqual(['fake-harness: prompt is a string with text']);
});

test("runHarness refuses with the check's reason, running not even --version", async () => {
  const code = await run(
    { prompt: 'hi' },
    { check: () => Promise.resolve('the folder holds no skills') },
    // --version exiting with 1 would make it 127 had it run.
    { FAKE_CLAUDE_VERSION_EXIT: '1' },
  );

  expect({ code, stderr, ran: existsSync(file) }).toEqual({
    code: refused,
    stderr: ['fake-harness: the folder holds no skills'],
    ran: false,
  });
});

test('runHarness runs the program once the check passes', async () => {
  await run({ prompt: 'hi' }, { check: () => Promise.resolve(undefined) });

  expect(received(file).stdin).toBe('hi');
});

test('runHarness checks the path before the harness does', async () => {
  await run(
    { prompt: 'hi', path: 'missing' },
    { check: () => Promise.resolve('the folder holds no skills') },
  );

  expect(stderr).toEqual(['fake-harness: path is a folder']);
});

test('runHarness names the program by its name, not by its path, when it does not run', async () => {
  const code = await run(
    { prompt: 'hi' },
    {
      prepare: () => ({
        ok: true,
        bin: join(dir, 'none'),
        args: [],
        timeoutMs: 60_000,
        killGraceMs: 1_000,
      }),
    },
  );

  expect({ code, stderr }).toEqual({
    code: notRun,
    stderr: ['fake-harness: fake does not run'],
  });
});

test("runHarness exits with 124 with the program's name once it took longer than the harness's timeout", async () => {
  // Half a second leaves the fake's --version time to end; see
  // claude-headless's own timeout tests for why it is no longer.
  const code = await run(
    { prompt: 'hi' },
    {
      prepare: () => ({
        ok: true,
        bin: program,
        args: [],
        timeoutMs: 500,
        killGraceMs: 1_000,
      }),
    },
    { FAKE_CLAUDE_SLEEP_MS: '30000' },
  );

  expect({ code, last: stderr.at(-1) }).toEqual({
    code: timedOut,
    last: 'fake-harness: fake took longer than 500 ms',
  });
});
