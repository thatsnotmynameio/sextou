import { expect, test } from 'vitest';
import { readInput } from '../../../../harness/agnostic-cli/settings';

const workspace = '/work/space';

// Reads the input of a context that asks "hi", changed by `fields`.
function read(fields: Record<string, unknown> = {}) {
  return readInput(JSON.stringify({ prompt: 'hi', ...fields }), workspace);
}

test('readInput runs in the workspace with the prompt by default', () => {
  expect(read()).toEqual({
    ok: true,
    input: { fields: { prompt: 'hi' }, cwd: workspace, prompt: 'hi' },
  });
});

test('readInput hands the prompt on as written', () => {
  const prompt = '--model=opus\nthen {{.WORKSPACE}} and "quotes"';

  expect(read({ prompt })).toMatchObject({ ok: true, input: { prompt } });
});

test("readInput hands on every field of the context, for the harness's options", () => {
  expect(read({ model: 'opus', repo: 'org/app' })).toMatchObject({
    ok: true,
    input: { fields: { prompt: 'hi', model: 'opus', repo: 'org/app' } },
  });
});

test.each([
  ['a folder', 'code', '/work/space/code'],
  ['the workspace itself', '.', workspace],
])('readInput runs in %s', (_name, path, cwd) => {
  expect(read({ path })).toMatchObject({ ok: true, input: { cwd } });
});

test.each([
  ['the folder above the workspace', '..'],
  ['a path that is not a string', 7],
  ['a path with a NUL', 'code\0'],
])('readInput refuses %s as path', (_name, path) => {
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
])('readInput refuses %s as context', (_name, context) => {
  expect(readInput(context, workspace)).toEqual({
    ok: false,
    reason: 'context is a JSON object',
  });
});

test.each([
  ['a relative workspace', 'work/space'],
  ['no workspace', ''],
])('readInput refuses %s', (_name, folder) => {
  expect(readInput('{"prompt":"hi"}', folder)).toEqual({
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
])('readInput refuses %s', (_name, prompt) => {
  expect(read({ prompt })).toEqual({
    ok: false,
    reason: 'prompt is a string with text',
  });
});
