import { expect, test } from 'vitest';
import {
  defaultKillGraceMs,
  insideWorkspace,
  readBin,
  readContext,
  readTimeout,
} from '../../../shared/settings';

const workspace = '/work/space';

test('readContext reads the fields of a JSON object', () => {
  expect(readContext('{"prompt":"hi","path":"code"}', workspace)).toEqual({
    ok: true,
    fields: { prompt: 'hi', path: 'code' },
  });
});

test.each([
  ['text that is not JSON', 'hi'],
  ['an array', '[]'],
  ['null', 'null'],
  ['a string', '"hi"'],
  ['nothing', ''],
])('readContext refuses %s', (_name, context) => {
  expect(readContext(context, workspace)).toEqual({
    ok: false,
    reason: 'context is a JSON object',
  });
});

test.each([
  ['a relative workspace', 'work/space'],
  ['no workspace', ''],
])('readContext refuses %s', (_name, folder) => {
  expect(readContext('{}', folder)).toEqual({
    ok: false,
    reason: 'workspace is an absolute path',
  });
});

test.each([
  ['a folder', 'code', '/work/space/code'],
  ['a nested folder', 'code/app', '/work/space/code/app'],
  ['a folder that comes back inside', 'code/../app', '/work/space/app'],
  ['the workspace itself', '.', workspace],
  ['an empty path, the workspace too', '', workspace],
  ['a segment that only starts with ..', '..code', '/work/space/..code'],
  [
    'an absolute path inside the workspace',
    '/work/space/code',
    '/work/space/code',
  ],
])(
  'insideWorkspace resolves %s against the workspace',
  (_name, path, resolved) => {
    expect(insideWorkspace(workspace, path)).toBe(resolved);
  },
);

test('insideWorkspace resolves against a workspace written with a trailing slash', () => {
  expect(insideWorkspace('/work/space/', 'code')).toBe('/work/space/code');
});

test.each([
  ['a path that is not a string', 7],
  ['no path', undefined],
  ['the folder above the workspace', '..'],
  ['a path that leaves the workspace', 'code/../../out'],
  ['an absolute path outside the workspace', '/tmp/out'],
  ['a sibling that starts like the workspace', '../space-other'],
  ['a path with a NUL', 'code\0'],
])('insideWorkspace refuses %s', (_name, path) => {
  expect(insideWorkspace(workspace, path)).toBeUndefined();
});

test('readTimeout is the fallback when the variable is not set', () => {
  expect(readTimeout(undefined, 300_000)).toBe(300_000);
});

test.each([
  ['1', 1],
  ['1000', 1000],
  ['2147483647', 2147483647],
])('readTimeout takes %s milliseconds', (value, ms) => {
  expect(readTimeout(value, 300_000)).toBe(ms);
});

test.each([
  ['0', '0'],
  ['a negative number', '-1'],
  ['a fraction', '1.5'],
  ['more than a timer takes', '2147483648'],
  ['a leading zero', '010'],
  ['a space', ' 10'],
  ['a unit', '10s'],
  ['an empty value', ''],
])('readTimeout refuses %s', (_name, value) => {
  expect(readTimeout(value, 300_000)).toBeUndefined();
});

test('a stopped program may take 10 seconds to exit by default, as the runner gives', () => {
  expect(defaultKillGraceMs).toBe(10_000);
});

test.each([
  ['unset', undefined],
  ['empty', ''],
])('readBin is the fallback when the variable is %s', (_name, value) => {
  expect(readBin(value, 'claude')).toBe('claude');
});

test.each([
  ['a command on the PATH', 'claude-beta'],
  ['an absolute path', '/opt/claude/bin/claude'],
])('readBin takes %s', (_name, value) => {
  expect(readBin(value, 'claude')).toBe(value);
});

test.each([
  ['a path from the current folder', './bin/claude'],
  ['a path from the folder above', '../claude'],
  ['a path with no dot', 'bin/claude'],
])('readBin refuses %s', (_name, value) => {
  expect(readBin(value, 'claude')).toBeUndefined();
});
