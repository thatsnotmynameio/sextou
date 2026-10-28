import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  headless,
  noClaude,
  refused,
  timedOut,
} from '../../../../harness/claude-headless/headless';
import { received, writeFakeClaude } from '../../../fake-claude';

// headless() in this process, so coverage and Stryker see it, running a
// fake claude the test writes to disk, never the real one.

let dir: string;
let workspace: string;
let claude: string;
let file: string;
let stdout: string[];
let stderr: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-claude-headless-'));
  workspace = join(dir, 'workspace');
  mkdirSync(workspace);
  claude = writeFakeClaude(dir);
  file = join(dir, 'received.json');
  stdout = [];
  stderr = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Runs claude -p for `context` in the workspace, with the fake claude.
// `env` replaces variables of the environment it gets.
function run(context: Record<string, unknown>, env: NodeJS.ProcessEnv = {}) {
  return headless(
    {
      ...process.env,
      CLAUDE_HEADLESS_BIN: claude,
      CLAUDE_HEADLESS_CONTEXT: JSON.stringify(context),
      CLAUDE_HEADLESS_WORKSPACE: workspace,
      FAKE_CLAUDE_RECEIVED: file,
      ...env,
    },
    {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    },
  );
}

test('headless hands claude the prompt on its stdin', async () => {
  await run({ prompt: 'fix the build\nthen test it' });

  expect(received(file).stdin).toBe('fix the build\nthen test it');
});

test('headless runs claude -p with the options of the context', async () => {
  await run({ prompt: 'hi', model: 'opus', allowedTools: ['Read', 'Edit'] });

  expect(received(file).args).toEqual([
    '-p',
    '--model=opus',
    '--allowed-tools=Read',
    '--allowed-tools=Edit',
  ]);
});

test('headless runs claude in the workspace by default', async () => {
  await run({ prompt: 'hi' });

  expect(received(file).cwd).toBe(workspace);
});

test('headless runs claude in the path of the context', async () => {
  mkdirSync(join(workspace, 'code'));

  await run({ prompt: 'hi', path: 'code' });

  expect(received(file).cwd).toBe(join(workspace, 'code'));
});

test('headless hands on each line claude writes, by its stream', async () => {
  await run({ prompt: 'hi' });

  expect({ stdout, stderr }).toEqual({
    stdout: ['first line', 'second line'],
    stderr: ['a warning'],
  });
});

test('headless exits with 0 when claude does', async () => {
  expect(await run({ prompt: 'hi' })).toBe(0);
});

test('headless exits with the exit code of claude', async () => {
  expect(await run({ prompt: 'hi' }, { FAKE_CLAUDE_EXIT: '3' })).toBe(3);
});

test('headless exits with 1 when a signal ends claude', async () => {
  expect(await run({ prompt: 'hi' }, { FAKE_CLAUDE_SIGNAL: 'SIGKILL' })).toBe(
    1,
  );
});

test('headless exits with the exit code of a claude that ends before it reads the prompt', async () => {
  // A prompt longer than a pipe holds, so the write fails once claude ended.
  const prompt = 'hi '.repeat(1_000_000);

  expect(
    await run(
      { prompt },
      { FAKE_CLAUDE_SKIP_STDIN: '1', FAKE_CLAUDE_EXIT: '5' },
    ),
  ).toBe(5);
});

test("headless hands claude the runner's environment", async () => {
  await run({ prompt: 'hi' }, { SEXTOU_TEST_MARKER: 'set' });

  expect(received(file).env).toContain('SEXTOU_TEST_MARKER');
});

test('headless keeps its own CLAUDE_HEADLESS_ variables from claude', async () => {
  await run({ prompt: 'hi' }, { CLAUDE_HEADLESS_TIMEOUT_MS: '60000' });

  expect(
    received(file).env.filter((name) => name.startsWith('CLAUDE_HEADLESS_')),
  ).toEqual([]);
});

// Runs `context` with `env`, and resolves with the exit code and the lines
// written on stderr.
async function outcome(
  context: Record<string, unknown>,
  env: NodeJS.ProcessEnv = {},
) {
  const code = await run(context, env);
  return { code, stderr };
}

// Each input headless refuses before it runs claude, beside the reason it
// writes; `setup` makes what the case needs in the workspace.
const refusals: [
  name: string,
  context: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  reason: string,
  setup?: () => void,
][] = [
  ['a context it refuses', { prompt: '' }, {}, 'prompt is a string with text'],
  [
    'an option of claude it refuses',
    { prompt: 'hi', model: 7 },
    {},
    'model is a string',
  ],
  [
    'a missing context',
    {},
    { CLAUDE_HEADLESS_CONTEXT: undefined },
    'context is a JSON object',
  ],
  [
    'a missing workspace',
    { prompt: 'hi' },
    { CLAUDE_HEADLESS_WORKSPACE: undefined },
    'workspace is an absolute path',
  ],
  [
    'a CLAUDE_HEADLESS_TIMEOUT_MS that is not a number of milliseconds',
    { prompt: 'hi' },
    { CLAUDE_HEADLESS_TIMEOUT_MS: '10s' },
    'CLAUDE_HEADLESS_TIMEOUT_MS is a whole number of milliseconds from 1 to 2147483647',
  ],
  [
    'a CLAUDE_HEADLESS_KILL_GRACE_MS that is not a number of milliseconds',
    { prompt: 'hi' },
    { CLAUDE_HEADLESS_KILL_GRACE_MS: '0' },
    'CLAUDE_HEADLESS_KILL_GRACE_MS is a whole number of milliseconds from 1 to 2147483647',
  ],
  [
    'a CLAUDE_HEADLESS_BIN that is a relative path',
    { prompt: 'hi' },
    { CLAUDE_HEADLESS_BIN: './claude' },
    'CLAUDE_HEADLESS_BIN is a command on the PATH or an absolute path',
  ],
  [
    'a path through a symlink out of the workspace',
    { prompt: 'hi', path: 'link' },
    {},
    'path is inside the workspace',
    () => {
      const outside = join(dir, 'outside');
      mkdirSync(outside);
      symlinkSync(outside, join(workspace, 'link'));
    },
  ],
  [
    'a path that does not exist',
    { prompt: 'hi', path: 'missing' },
    {},
    'path is a folder',
  ],
  [
    'a path that is a file',
    { prompt: 'hi', path: 'notes.txt' },
    {},
    'path is a folder',
    () => writeFileSync(join(workspace, 'notes.txt'), 'notes'),
  ],
];

test.each(refusals)(
  'headless refuses %s: exit code 2, the reason on stderr',
  async (_name, context, env, reason, setup) => {
    setup?.();

    expect(await outcome(context, env)).toEqual({
      code: refused,
      stderr: [`claude-headless: ${reason}`],
    });
  },
);

test.each(refusals)(
  'headless runs no claude on %s',
  async (_name, context, env, _reason, setup) => {
    setup?.();

    await run(context, env);

    expect(existsSync(file)).toBe(false);
  },
);

test('headless runs claude in a workspace that is itself a symlink', async () => {
  const link = join(dir, 'link');
  symlinkSync(workspace, link);

  await run({ prompt: 'hi' }, { CLAUDE_HEADLESS_WORKSPACE: link });

  expect(received(file).stdin).toBe('hi');
});

test('headless exits with 127 with its reason when CLAUDE_HEADLESS_BIN names no program', async () => {
  expect(
    await outcome({ prompt: 'hi' }, { CLAUDE_HEADLESS_BIN: join(dir, 'none') }),
  ).toEqual({
    code: noClaude,
    stderr: ['claude-headless: claude does not run'],
  });
});

test('headless exits with 127 when claude --version fails', async () => {
  expect(await run({ prompt: 'hi' }, { FAKE_CLAUDE_VERSION_EXIT: '1' })).toBe(
    noClaude,
  );
});

test('headless runs no claude -p when claude --version fails', async () => {
  await run({ prompt: 'hi' }, { FAKE_CLAUDE_VERSION_EXIT: '1' });

  expect(existsSync(file)).toBe(false);
});

test('headless runs claude from the PATH when CLAUDE_HEADLESS_BIN is empty', async () => {
  await run(
    { prompt: 'hi' },
    { CLAUDE_HEADLESS_BIN: '', PATH: `${dir}:${process.env.PATH}` },
  );

  expect(received(file).stdin).toBe('hi');
});

// A claude that sleeps 30 seconds, under a timeout of half a second, which
// leaves the fake claude's --version time to end. Stryker runs each test
// again for every mutant it covers, so each second a run lasts costs minutes.
const slow = {
  CLAUDE_HEADLESS_TIMEOUT_MS: '500',
  FAKE_CLAUDE_SLEEP_MS: '30000',
};

test('headless exits with 124 with its reason once claude took longer than CLAUDE_HEADLESS_TIMEOUT_MS', async () => {
  // The reason is the last line, whether or not the run, a second node to
  // start under the same deadline, wrote its warning before it.
  const { code, stderr } = await outcome({ prompt: 'hi' }, slow);

  expect({ code, last: stderr.at(-1) }).toEqual({
    code: timedOut,
    last: 'claude-headless: claude took longer than 500 ms',
  });
});

test('headless kills claude once it took longer than CLAUDE_HEADLESS_TIMEOUT_MS', async () => {
  const started = Date.now();

  await run({ prompt: 'hi' }, slow);

  expect(Date.now() - started).toBeLessThan(10_000);
});
