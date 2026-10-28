import { expect, test } from 'vitest';
import {
  defaultTimeoutMs,
  readSettings,
} from '../../../../work-summary/check/settings';

const workspace = '/work/space';

// Reads the settings of a context with a base, a plan and a summary, changed
// by `fields`.
function read(fields: Record<string, unknown> = {}) {
  return readSettings(
    JSON.stringify({
      base: 'main',
      plan: 'docs/plan.md',
      summary: 'summary.json',
      ...fields,
    }),
    workspace,
  );
}

// Why read() refuses `fields`.
function reason(fields: Record<string, unknown>) {
  const result = read(fields);
  return result.ok ? undefined : result.reason;
}

test('readSettings reads a full context', () => {
  expect(
    read({
      path: 'code',
      ignore: ['docs/plan.md'],
      summary: 'out/summary.json',
    }),
  ).toEqual({
    ok: true,
    settings: {
      path: '/work/space/code',
      base: 'main',
      plan: 'docs/plan.md',
      planFile: '/work/space/code/docs/plan.md',
      ignore: ['docs/plan.md'],
      summary: '/work/space/out/summary.json',
    },
  });
});

test('readSettings takes the workspace as the repository and ignores nothing by default', () => {
  expect(read()).toEqual({
    ok: true,
    settings: {
      path: workspace,
      base: 'main',
      plan: 'docs/plan.md',
      planFile: '/work/space/docs/plan.md',
      ignore: [],
      summary: '/work/space/summary.json',
    },
  });
});

test('readSettings refuses a context readContext refuses', () => {
  expect(readSettings('[]', workspace)).toEqual({
    ok: false,
    reason: 'context is a JSON object',
  });
});

test.each([
  [
    'a path outside the workspace',
    { path: '..' },
    'path is inside the workspace',
  ],
  ['a path that is not a string', { path: 3 }, 'path is inside the workspace'],
  ['no base', { base: undefined }, 'base is a ref'],
  ['an empty base', { base: '' }, 'base is a ref'],
  ['a base that is not a string', { base: 1 }, 'base is a ref'],
  ['a base that starts with -', { base: '--all' }, 'base is a ref'],
  ['a base with a NUL', { base: 'ma\0in' }, 'base is a ref'],
  ['no plan', { plan: undefined }, 'plan is a path in the repository'],
  [
    'a plan that is not a string',
    { plan: ['docs/plan.md'] },
    'plan is a path in the repository',
  ],
  [
    'a plan outside the repository',
    { path: 'code', plan: '../plan.md' },
    'plan is a path in the repository',
  ],
  [
    'an ignore that is a string',
    { ignore: 'docs/plan.md' },
    'ignore is a list of paths',
  ],
  [
    'an ignore with a number',
    { ignore: ['docs/plan.md', 1] },
    'ignore is a list of paths',
  ],
  [
    'no summary',
    { summary: undefined },
    'summary is a path inside the workspace',
  ],
  [
    'a summary outside the workspace',
    { summary: '../summary.json' },
    'summary is a path inside the workspace',
  ],
])('readSettings refuses %s', (_name, fields, expected) => {
  expect(reason(fields)).toBe(expected);
});

test('readSettings takes a base with / and ^, as git names refs', () => {
  expect(reason({ base: 'origin/main^' })).toBeUndefined();
});

test("the check's git may take a minute by default", () => {
  expect(defaultTimeoutMs).toBe(60_000);
});
