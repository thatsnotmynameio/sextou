import { expect, test } from 'vitest';
import {
  claimOutputSchema,
  usesSchema,
} from '../../../../src/modules/runners/runners.schema';

const uses = {
  repo: 'thatsnotmynameio/sextou',
  sha: '0123456789abcdef0123456789abcdef01234567',
  taskfile: 'tasks/hello-world/Taskfile.yml',
};

test('usesSchema takes a repository, a full commit and a path inside it', () => {
  expect(usesSchema.parse(uses)).toEqual(uses);
});

test.each([
  ['a repository without an owner', { repo: 'sextou' }],
  ['a repository with a space', { repo: 'thatsnotmynameio/sex tou' }],
  ['a repository with a third segment', { repo: 'a/b/c' }],
  ['a repository whose owner is ..', { repo: '../sextou' }],
  ['a repository whose name is ..', { repo: 'thatsnotmynameio/..' }],
  ['a repository whose owner is .', { repo: './sextou' }],
  ['a repository whose name is .', { repo: 'thatsnotmynameio/.' }],
  ['a short commit', { sha: '0123456' }],
  ['an uppercase commit', { sha: uses.sha.toUpperCase() }],
  ['a commit with a trailing character', { sha: `${uses.sha}0` }],
  ['an empty path', { taskfile: '' }],
  ['an absolute path', { taskfile: '/etc/Taskfile.yml' }],
  ['a path that leaves the repository', { taskfile: '../Taskfile.yml' }],
  ['a path with a .. segment inside', { taskfile: 'tasks/../../x.yml' }],
  ['the repository itself', { taskfile: '.' }],
  ['a path with a . segment', { taskfile: './Taskfile.yml' }],
  ['a folder', { taskfile: 'tasks/hello-world/' }],
  ['a path with an empty segment', { taskfile: 'tasks//Taskfile.yml' }],
])('usesSchema refuses %s', (_name, change) => {
  expect(usesSchema.safeParse({ ...uses, ...change }).success).toBe(false);
});

test('usesSchema takes a repository whose name only starts with a dot', () => {
  expect(
    usesSchema.safeParse({ ...uses, repo: 'thatsnotmynameio/.github' }).success,
  ).toBe(true);
});

test('usesSchema takes a path whose segment only starts with ..', () => {
  expect(
    usesSchema.safeParse({ ...uses, taskfile: 'tasks/..hidden/x.yml' }).success,
  ).toBe(true);
});

test('usesSchema names why it refuses a path that leaves the repository', () => {
  const result = usesSchema.safeParse({ ...uses, taskfile: '../x.yml' });

  expect(result.error?.issues.map((issue) => issue.message)).toEqual([
    'a path inside the repository',
  ]);
});

test('usesSchema names why it refuses a repository named ..', () => {
  const result = usesSchema.safeParse({ ...uses, repo: 'a/..' });

  expect(result.error?.issues.map((issue) => issue.message)).toEqual([
    'owner/name',
  ]);
});

// A claim's answer for a task, with the context and the uses a test sets.
function held(context: unknown, taskUses: unknown) {
  return {
    task: { id: 'tsk_1', uses: taskUses, context },
    execution: { id: 'exe_1', attempt: 1, leaseMs: 30000 },
  };
}

test.each([
  ['a context', { repo: 'org/app', nested: { list: [1, 'a', null] } }],
  ['an empty context', {}],
  ['a null context', null],
])('claimOutputSchema takes a task with %s', (_name, context) => {
  expect(claimOutputSchema.parse(held(context, uses))).toEqual(
    held(context, uses),
  );
});

test.each([
  ['an array', [1]],
  ['a string', 'org/app'],
  ['a number', 7],
  ['undefined', undefined],
])('claimOutputSchema refuses %s as context', (_name, context) => {
  expect(claimOutputSchema.safeParse(held(context, uses)).success).toBe(false);
});

test('claimOutputSchema takes a task with a null uses', () => {
  expect(claimOutputSchema.parse(held(null, null))).toEqual(held(null, null));
});

test.each([
  ['a uses left out', undefined],
  ['a uses as a string', `thatsnotmynameio/sextou/x.yml@${uses.sha}`],
  ['a uses with a short commit', { ...uses, sha: '0123456' }],
])('claimOutputSchema refuses %s', (_name, taskUses) => {
  expect(claimOutputSchema.safeParse(held(null, taskUses)).success).toBe(false);
});
