import { expect, test } from 'vitest';
import {
  claimOutputSchema,
  sourceSchema,
} from '../../../../src/modules/runners/runners.schema';

const source = {
  repo: 'thatsnotmynameio/sextou',
  sha: '0123456789abcdef0123456789abcdef01234567',
  taskfile: 'tasks/hello-world/Taskfile.yml',
};

test('sourceSchema takes a repository, a full commit and a path inside it', () => {
  expect(sourceSchema.parse(source)).toEqual(source);
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
  ['an uppercase commit', { sha: source.sha.toUpperCase() }],
  ['a commit with a trailing character', { sha: `${source.sha}0` }],
  ['an empty path', { taskfile: '' }],
  ['an absolute path', { taskfile: '/etc/Taskfile.yml' }],
  ['a path that leaves the repository', { taskfile: '../Taskfile.yml' }],
  ['a path with a .. segment inside', { taskfile: 'tasks/../../x.yml' }],
  ['the repository itself', { taskfile: '.' }],
  ['a path with a . segment', { taskfile: './Taskfile.yml' }],
  ['a folder', { taskfile: 'tasks/hello-world/' }],
  ['a path with an empty segment', { taskfile: 'tasks//Taskfile.yml' }],
])('sourceSchema refuses %s', (_name, change) => {
  expect(sourceSchema.safeParse({ ...source, ...change }).success).toBe(false);
});

test('sourceSchema takes a repository whose name only starts with a dot', () => {
  expect(
    sourceSchema.safeParse({ ...source, repo: 'thatsnotmynameio/.github' })
      .success,
  ).toBe(true);
});

test('sourceSchema takes a path whose segment only starts with ..', () => {
  expect(
    sourceSchema.safeParse({ ...source, taskfile: 'tasks/..hidden/x.yml' })
      .success,
  ).toBe(true);
});

test('sourceSchema names why it refuses a path that leaves the repository', () => {
  const result = sourceSchema.safeParse({ ...source, taskfile: '../x.yml' });

  expect(result.error?.issues.map((issue) => issue.message)).toEqual([
    'a path inside the repository',
  ]);
});

test('sourceSchema names why it refuses a repository named ..', () => {
  const result = sourceSchema.safeParse({ ...source, repo: 'a/..' });

  expect(result.error?.issues.map((issue) => issue.message)).toEqual([
    'owner/name',
  ]);
});

// A claim's answer for a task, with the context a test sets.
function held(context: unknown) {
  return {
    task: { id: 'tsk_1', source, context },
    execution: { id: 'exe_1', attempt: 1, leaseMs: 30000 },
  };
}

test.each([
  ['a context', { repo: 'org/app', nested: { list: [1, 'a', null] } }],
  ['an empty context', {}],
  ['a null context', null],
])('claimOutputSchema takes a task with %s', (_name, context) => {
  expect(claimOutputSchema.parse(held(context))).toEqual(held(context));
});

test.each([
  ['an array', [1]],
  ['a string', 'org/app'],
  ['a number', 7],
  ['undefined', undefined],
])('claimOutputSchema refuses %s as context', (_name, context) => {
  expect(claimOutputSchema.safeParse(held(context)).success).toBe(false);
});
