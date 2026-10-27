import { expect, test } from 'vitest';
import {
  claimOutputSchema,
  completeInputSchema,
  completeOutputSchema,
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

/**
 * A claim's answer that hands the runner task tsk_1 and its first attempt.
 * @param context the task's context
 * @param taskUses the task's uses: split, null, or a value the schema refuses
 */
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

const completion = {
  runner: 'runner-1',
  executionId: 'exe_1',
  outcome: 'succeeded',
};

test('completeInputSchema takes a completion without a tasks file', () => {
  expect(completeInputSchema.parse(completion)).toEqual(completion);
});

test('completeInputSchema takes a tasks file of any size, as text', () => {
  const tasks = 'x'.repeat(5_000_000);

  expect(completeInputSchema.parse({ ...completion, tasks })).toEqual({
    ...completion,
    tasks,
  });
});

test('completeInputSchema refuses a tasks file that is not text', () => {
  expect(
    completeInputSchema.safeParse({ ...completion, tasks: { tasks: [] } })
      .success,
  ).toBe(false);
});

test('completeOutputSchema takes the outcome, its reason and the created tasks', () => {
  const answer = {
    outcome: 'failed',
    reason: 'the tasks file is not JSON',
    created: [{ key: 'review', id: 'tsk_2' }],
  };

  expect(completeOutputSchema.parse(answer)).toEqual(answer);
});

test('completeOutputSchema takes a null reason', () => {
  const answer = { outcome: 'succeeded', reason: null, created: [] };

  expect(completeOutputSchema.parse(answer)).toEqual(answer);
});

test.each([
  ['a state that is not an outcome', { outcome: 'running' }],
  ['a reason left out', { reason: undefined }],
  ['created left out', { created: undefined }],
  ['a created task with an empty id', { created: [{ key: 'a', id: '' }] }],
  ['a created task with no key', { created: [{ id: 'tsk_2' }] }],
])('completeOutputSchema refuses %s', (_name, fields) => {
  expect(
    completeOutputSchema.safeParse({
      outcome: 'succeeded',
      reason: null,
      created: [],
      ...fields,
    }).success,
  ).toBe(false);
});
