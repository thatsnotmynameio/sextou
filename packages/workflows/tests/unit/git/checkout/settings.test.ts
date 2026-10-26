import { expect, test } from 'vitest';
import {
  defaultTimeoutMs,
  readSettings,
} from '../../../../git/checkout/settings';

const workspace = '/work/space';

// Reads the settings of a context with repo org/app at main, changed by
// `fields`.
function read(fields: Record<string, unknown> = {}) {
  return readSettings(
    JSON.stringify({ repo: 'org/app', ref: 'main', ...fields }),
    workspace,
  );
}

test('readSettings clones repo from GitHub at ref into the workspace by default', () => {
  expect(read()).toEqual({
    ok: true,
    settings: {
      url: 'https://github.com/org/app',
      ref: 'main',
      path: workspace,
    },
  });
});

test.each([
  ['a commit', '0123456789abcdef0123456789abcdef01234567'],
  ['a branch with a slash', 'feature/login'],
  ['a tag', 'v1.2.3'],
  ['a qualified branch', 'refs/heads/main'],
])('readSettings takes %s as ref', (_name, ref) => {
  expect(read({ ref })).toMatchObject({ ok: true, settings: { ref } });
});

test.each([
  ['a folder', 'code', '/work/space/code'],
  ['a nested folder', 'code/app', '/work/space/code/app'],
  ['a folder that comes back inside', 'code/../app', '/work/space/app'],
  ['the workspace itself', '.', workspace],
  ['a segment that only starts with ..', '..code', '/work/space/..code'],
  [
    'an absolute path inside the workspace',
    '/work/space/code',
    '/work/space/code',
  ],
])('readSettings takes %s as path', (_name, path, resolved) => {
  expect(read({ path })).toMatchObject({
    ok: true,
    settings: { path: resolved },
  });
});

test.each([
  ['a server of its own', 'https://git.example.com', 'https://git.example.com'],
  ['a port', 'https://127.0.0.1:8443', 'https://127.0.0.1:8443'],
  ['a trailing slash', 'https://github.com/', 'https://github.com'],
  ['a path, which it drops', 'https://github.com/other', 'https://github.com'],
])('readSettings takes a server with %s', (_name, server, origin) => {
  expect(read({ server })).toMatchObject({
    ok: true,
    settings: { url: `${origin}/org/app` },
  });
});

test.each([
  ['a dot', 'org/.github'],
  ['digits, _ and -', 'org-2/my_app-1'],
])('readSettings takes a repo whose name has %s', (_name, repo) => {
  expect(read({ repo })).toMatchObject({
    ok: true,
    settings: { url: `https://github.com/${repo}` },
  });
});

test.each([
  ['text that is not JSON', 'org/app'],
  ['an array', '[]'],
  ['null', 'null'],
  ['a string', '"org/app"'],
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
  expect(readSettings('{"repo":"org/app","ref":"main"}', folder)).toEqual({
    ok: false,
    reason: 'workspace is an absolute path',
  });
});

test.each([
  ['no repo', undefined],
  ['a repo that is not a string', ['org', 'app']],
  ['a repo with no owner', 'app'],
  ['a repo with an empty owner', '/app'],
  ['a repo with an empty name', 'org/'],
  ['a repo with a third part', 'a/b/c'],
  ['a repo named .', 'org/.'],
  ['a repo named ..', 'org/..'],
  ['a repo owned by .', './app'],
  ['a repo owned by ..', '../app'],
  ['a repo with a space', 'org/my app'],
  ['a repo with a command', 'org/app;touch'],
  ['a repo with a second line', 'org/app\nother/app'],
  ['a repo with a query', 'org/app?x=1'],
])('readSettings refuses %s', (_name, repo) => {
  expect(read({ repo })).toEqual({ ok: false, reason: 'repo is owner/name' });
});

test.each([
  ['no ref', undefined],
  ['an empty ref', ''],
  ['a ref that is not a string', 7],
  ['a ref that is an option', '--upload-pack=touch'],
  ['a ref that starts with -', '-main'],
  ['a ref with a :', 'main:refs/heads/other'],
  ['a ref with a *', 'refs/heads/*'],
  ['a ref with a space', 'main other'],
  ['a ref with a second line', 'main\nother'],
  ['a ref with a tab', 'main\tother'],
  ['a ref with a NUL', 'main\0'],
])('readSettings refuses %s', (_name, ref) => {
  expect(read({ ref })).toEqual({
    ok: false,
    reason: 'ref is a commit, a branch or a tag',
  });
});

test.each([
  ['a path that is not a string', 7],
  ['the folder above the workspace', '..'],
  ['a path that leaves the workspace', 'code/../../out'],
  ['an absolute path outside the workspace', '/tmp/out'],
  ['a sibling that starts like the workspace', '../space-other'],
  ['a path with a NUL', 'code\0'],
])('readSettings refuses %s', (_name, path) => {
  expect(read({ path })).toEqual({
    ok: false,
    reason: 'path is inside the workspace',
  });
});

test.each([
  ['a server that is not a string', 443],
  ['a server in a list', ['https://github.com']],
  ['a server that is not a URL', 'github.com'],
  ['a server on the disk of the runner', 'file:///home'],
  ['a server over plain http', 'http://github.com'],
  ['a server over ssh', 'ssh://git@github.com'],
  ['a server that runs a command', 'ext::sh -c touch% pwned'],
])('readSettings refuses %s', (_name, server) => {
  expect(read({ server })).toEqual({
    ok: false,
    reason: 'server is an https URL',
  });
});

test('the checkout may take 5 minutes when CHECKOUT_TIMEOUT_MS is not set', () => {
  expect(defaultTimeoutMs).toBe(300_000);
});
