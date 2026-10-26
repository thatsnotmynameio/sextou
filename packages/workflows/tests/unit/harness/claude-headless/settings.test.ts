import { expect, test } from 'vitest';
import {
  defaultTimeoutMs,
  readSettings,
} from '../../../../harness/claude-headless/settings';

const workspace = '/work/space';

// Reads the settings of a context that asks "hi", changed by `fields`.
function read(fields: Record<string, unknown> = {}) {
  return readSettings(JSON.stringify({ prompt: 'hi', ...fields }), workspace);
}

// The arguments claude gets for a context with `fields`, -p left out.
function args(fields: Record<string, unknown>) {
  const result = read(fields);
  return result.ok ? result.settings.args.slice(1) : result.reason;
}

test('readSettings runs claude -p in the workspace with the prompt by default', () => {
  expect(read()).toEqual({
    ok: true,
    settings: { cwd: workspace, args: ['-p'], prompt: 'hi' },
  });
});

test('readSettings hands the prompt on as written', () => {
  const prompt = '--model=opus\nthen {{.WORKSPACE}} and "quotes"';

  expect(read({ prompt })).toMatchObject({ ok: true, settings: { prompt } });
});

test('readSettings leaves the keys it does not know to the other steps', () => {
  expect(read({ repo: 'org/app', ref: 'main', server: 'x' })).toEqual(read());
});

test.each([
  ['a folder', 'code', '/work/space/code'],
  ['the workspace itself', '.', workspace],
])('readSettings runs claude in %s', (_name, path, cwd) => {
  expect(read({ path })).toMatchObject({ ok: true, settings: { cwd } });
});

test.each([
  ['the folder above the workspace', '..'],
  ['a path that is not a string', 7],
  ['a path with a NUL', 'code\0'],
])('readSettings refuses %s as path', (_name, path) => {
  expect(read({ path })).toEqual({
    ok: false,
    reason: 'path is inside the workspace',
  });
});

test.each([
  ['text that is not JSON', 'hi'],
  ['an array', '[]'],
  ['null', 'null'],
  ['a string', '"hi"'],
  ['nothing', ''],
])('readSettings refuses %s as context', (_name, context) => {
  expect(readSettings(context, workspace)).toEqual({
    ok: false,
    reason: 'context is a JSON object',
  });
});

test.each([
  ['a relative workspace', 'work/space'],
  ['no workspace', ''],
])('readSettings refuses %s', (_name, folder) => {
  expect(readSettings('{"prompt":"hi"}', folder)).toEqual({
    ok: false,
    reason: 'workspace is an absolute path',
  });
});

test.each([
  ['no prompt', undefined],
  ['an empty prompt', ''],
  ['a prompt of spaces', ' \n\t'],
  ['a prompt that is not a string', 7],
  ['a prompt in a list', ['hi']],
])('readSettings refuses %s', (_name, prompt) => {
  expect(read({ prompt })).toEqual({
    ok: false,
    reason: 'prompt is a string with text',
  });
});

test('readSettings asks for a worktree claude names when worktree is true', () => {
  expect(args({ worktree: true })).toEqual(['--worktree']);
});

test.each([
  ['a name', 'review'],
  ['digits, _, . and -', 'fix_2.v-1'],
  ['a name that starts with .', '.review'],
])('readSettings asks for a worktree with %s', (_name, worktree) => {
  expect(args({ worktree })).toEqual([`--worktree=${worktree}`]);
});

test('readSettings asks for no worktree when worktree is false', () => {
  expect(args({ worktree: false })).toEqual([]);
});

test.each([
  ['an empty name', ''],
  ['a name that starts with -', '-review'],
  ['a name with a /', 'a/b'],
  ['a name with a space', 'a b'],
  ['.', '.'],
  ['..', '..'],
  ['a number', 7],
  ['null', null],
])('readSettings refuses %s as worktree', (_name, worktree) => {
  expect(read({ worktree })).toEqual({
    ok: false,
    reason: 'worktree is true, false or a name',
  });
});

test.each([
  ['model', 'opus', ['--model=opus']],
  ['effort', 'high', ['--effort=high']],
  ['agent', 'reviewer', ['--agent=reviewer']],
  ['systemPrompt', 'be brief', ['--system-prompt=be brief']],
  ['appendSystemPrompt', 'be brief', ['--append-system-prompt=be brief']],
  ['permissionMode', 'dontAsk', ['--permission-mode=dontAsk']],
  ['permissionPrompts', 'none', ['--permission-prompts=none']],
  ['autocompact', 'auto', ['--autocompact=auto']],
  ['name', 'review', ['--name=review']],
  ['sessionId', 'a-b', ['--session-id=a-b']],
  ['outputFormat', 'json', ['--output-format=json']],
])('readSettings passes %s as --name=value', (key, value, expected) => {
  expect(args({ [key]: value })).toEqual(expected);
});

test('readSettings passes a value that starts with - as the option value', () => {
  expect(args({ model: '--help' })).toEqual(['--model=--help']);
});

test('readSettings passes an empty string as an empty value', () => {
  expect(args({ model: '' })).toEqual(['--model=']);
});

test.each([
  ['fallbackModel', 'sonnet', ['--fallback-model=sonnet']],
  ['fallbackModel', ['sonnet', 'haiku'], ['--fallback-model=sonnet,haiku']],
  ['settingSources', ['user', 'project'], ['--setting-sources=user,project']],
  ['settingSources', [], ['--setting-sources=']],
])('readSettings joins %s with commas', (key, value, expected) => {
  expect(args({ [key]: value })).toEqual(expected);
});

test.each([
  ['a whole number', 2, ['--max-budget-usd=2']],
  ['a fraction', 0.5, ['--max-budget-usd=0.5']],
])(
  'readSettings passes maxBudgetUsd as %s',
  (_name, maxBudgetUsd, expected) => {
    expect(args({ maxBudgetUsd })).toEqual(expected);
  },
);

test.each([
  ['tools', ['Read', 'Edit'], ['--tools=Read', '--tools=Edit']],
  ['tools', '', ['--tools=']],
  [
    'allowedTools',
    ['Read', 'Bash(git status)'],
    ['--allowed-tools=Read', '--allowed-tools=Bash(git status)'],
  ],
  ['disallowedTools', 'WebFetch', ['--disallowed-tools=WebFetch']],
  ['addDir', ['../docs'], ['--add-dir=../docs']],
  [
    'pluginDir',
    ['plugins/a', 'plugins/b'],
    ['--plugin-dir=plugins/a', '--plugin-dir=plugins/b'],
  ],
  [
    'pluginUrl',
    ['https://x.test/p.zip'],
    ['--plugin-url=https://x.test/p.zip'],
  ],
  ['betas', ['one'], ['--betas=one']],
])(
  'readSettings passes each item of %s as its own argument',
  (key, value, expected) => {
    expect(args({ [key]: value })).toEqual(expected);
  },
);

test.each([
  [
    'agents',
    { reviewer: { prompt: 'review' } },
    ['--agents={"reviewer":{"prompt":"review"}}'],
  ],
  ['agents', 'agents.json', ['--agents=agents.json']],
  ['jsonSchema', { type: 'object' }, ['--json-schema={"type":"object"}']],
  ['settings', { model: 'opus' }, ['--settings={"model":"opus"}']],
  ['settings', '.claude/run.json', ['--settings=.claude/run.json']],
  ['mcpConfig', { mcpServers: {} }, ['--mcp-config={"mcpServers":{}}']],
  ['mcpConfig', 'mcp.json', ['--mcp-config=mcp.json']],
  [
    'mcpConfig',
    ['mcp.json', { mcpServers: {} }],
    ['--mcp-config=mcp.json', '--mcp-config={"mcpServers":{}}'],
  ],
])('readSettings passes %s as JSON or as written', (key, value, expected) => {
  expect(args({ [key]: value })).toEqual(expected);
});

test.each([
  ['dangerouslySkipPermissions', '--dangerously-skip-permissions'],
  ['allowDangerouslySkipPermissions', '--allow-dangerously-skip-permissions'],
  ['strictMcpConfig', '--strict-mcp-config'],
  ['bare', '--bare'],
  ['safeMode', '--safe-mode'],
  ['restricted', '--restricted'],
  ['disableSlashCommands', '--disable-slash-commands'],
  [
    'excludeDynamicSystemPromptSections',
    '--exclude-dynamic-system-prompt-sections',
  ],
  ['noSessionPersistence', '--no-session-persistence'],
  ['verbose', '--verbose'],
  ['includePartialMessages', '--include-partial-messages'],
  ['includeHookEvents', '--include-hook-events'],
  ['forwardSubagentText', '--forward-subagent-text'],
])('readSettings adds %s alone when it is true', (key, flag) => {
  expect(args({ [key]: true })).toEqual([flag]);
});

test('readSettings leaves a flag out when it is false', () => {
  expect(args({ verbose: false, bare: false })).toEqual([]);
});

test('readSettings orders the options as claude gets them, whatever the order of the context', () => {
  expect(
    read({
      verbose: true,
      outputFormat: 'stream-json',
      allowedTools: ['Read'],
      permissionMode: 'dontAsk',
      model: 'opus',
      worktree: 'review',
    }),
  ).toMatchObject({
    ok: true,
    settings: {
      args: [
        '-p',
        '--worktree=review',
        '--model=opus',
        '--permission-mode=dontAsk',
        '--allowed-tools=Read',
        '--output-format=stream-json',
        '--verbose',
      ],
    },
  });
});

test.each([
  ['model', 7, 'a string'],
  ['model', ['opus'], 'a string'],
  ['model', 'op\0us', 'a string'],
  ['fallbackModel', 7, 'a string or a list of strings'],
  ['fallbackModel', ['sonnet', 7], 'a string or a list of strings'],
  ['maxBudgetUsd', '2', 'a number'],
  ['maxBudgetUsd', Number.NaN, 'a number'],
  ['allowedTools', 'Re\0ad', 'a string or a non-empty list of strings'],
  ['allowedTools', ['Read', null], 'a string or a non-empty list of strings'],
  ['allowedTools', { Read: true }, 'a string or a non-empty list of strings'],
  ['allowedTools', [], 'a string or a non-empty list of strings'],
  ['tools', [], 'a string or a non-empty list of strings'],
  ['settings', 7, 'an object or a string'],
  ['settings', ['a.json'], 'an object or a string'],
  ['settings', null, 'an object or a string'],
  ['mcpConfig', 7, 'an object, a string or a non-empty list of them'],
  [
    'mcpConfig',
    ['mcp.json', 7],
    'an object, a string or a non-empty list of them',
  ],
  [
    'mcpConfig',
    [['mcp.json']],
    'an object, a string or a non-empty list of them',
  ],
  ['mcpConfig', [], 'an object, a string or a non-empty list of them'],
  ['verbose', 'true', 'true or false'],
  ['verbose', 1, 'true or false'],
])('readSettings refuses %s set to %j', (key, value, expected) => {
  expect(read({ [key]: value })).toEqual({
    ok: false,
    reason: `${key} is ${expected}`,
  });
});

test('readSettings passes no option the context leaves out', () => {
  expect(args({ model: undefined })).toEqual([]);
});

test('claude may take an hour when CLAUDE_HEADLESS_TIMEOUT_MS is not set', () => {
  expect(defaultTimeoutMs).toBe(3_600_000);
});
