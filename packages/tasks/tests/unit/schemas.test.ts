import { expect, test } from 'vitest';
import {
  assignTaskSchema,
  cancelTaskSchema,
  claimTaskSchema,
  createTaskSchema,
  expireExecutionsSchema,
  finishTaskSchema,
  linkSchema,
  listReadySchema,
  renewExecutionSchema,
  unlinkSchema,
} from '../../src/schemas';
import { Status } from '../../src/status';

test('createTaskSchema outputs a new task with its texts trimmed', () => {
  expect(
    createTaskSchema.parse({
      title: ' Write the parser ',
      kind: ' task ',
      priority: 2,
      parentId: ' tsk_1 ',
      assignee: ' dev ',
      description: ' Parse the input. ',
      sourcePath: ' ./notes/task.md ',
      context: { repo: ' org/app ', depth: 1, tags: ['a'], ref: null },
      createdBy: ' planner ',
    }),
  ).toEqual({
    title: 'Write the parser',
    kind: 'task',
    priority: 2,
    parentId: ' tsk_1 ',
    assignee: 'dev',
    description: 'Parse the input.',
    sourcePath: './notes/task.md',
    context: { repo: ' org/app ', depth: 1, tags: ['a'], ref: null },
    createdBy: 'planner',
  });
});

test('createTaskSchema outputs null for a description, source path and context left out', () => {
  expect(
    createTaskSchema.parse({
      title: 'A',
      kind: 'task',
      priority: 0,
      assignee: 'dev',
      createdBy: 'planner',
    }),
  ).toEqual({
    title: 'A',
    kind: 'task',
    priority: 0,
    assignee: 'dev',
    description: null,
    sourcePath: null,
    context: null,
    createdBy: 'planner',
  });
});

test('createTaskSchema outputs an empty context as given', () => {
  expect(
    createTaskSchema.parse({
      title: 'A',
      kind: 'task',
      priority: 0,
      assignee: 'dev',
      context: {},
      createdBy: 'planner',
    }),
  ).toMatchObject({ context: {} });
});

// A context whose innermost value sits inside this many objects and arrays,
// counting the context itself, alternating the two.
function nested(depth: number) {
  let value: unknown = 1;
  for (let level = 1; level < depth; level += 1) {
    value = level % 2 === 0 ? { a: value } : [value];
  }
  return { a: value };
}

function parseContext(context: unknown) {
  return createTaskSchema.safeParse({
    title: 'A',
    kind: 'task',
    priority: 0,
    assignee: 'dev',
    context,
    createdBy: 'planner',
  });
}

test.each([
  ['an array', ['org/app']],
  ['a string', 'org/app'],
  ['a number', 7],
  ['null', null],
  ['a value that is not a number in JSON', { depth: Number.NaN }],
  ['a function', { run: () => 'x' }],
  ['undefined inside it', { repo: undefined }],
  ['a date', { at: new Date(0) }],
])('createTaskSchema refuses a context that is %s', (_name, context) => {
  expect(parseContext(context).success).toBe(false);
});

test('createTaskSchema accepts a context nested 500 levels deep, as deep as Turso stores', () => {
  expect(parseContext(nested(500)).success).toBe(true);
});

test('createTaskSchema refuses a context nested 501 levels deep', () => {
  expect(parseContext(nested(501)).success).toBe(false);
});

test('createTaskSchema refuses a context nested far deeper without overflowing the stack', () => {
  expect(parseContext(nested(100_000)).success).toBe(false);
});

test('createTaskSchema refuses a context that holds itself', () => {
  const context: Record<string, unknown> = {};
  context.self = context;
  expect(parseContext(context).success).toBe(false);
});

test.each([linkSchema, unlinkSchema])(
  'the link schemas output both ids as given',
  (schema) => {
    expect(schema.parse({ taskId: ' tsk_1 ', blockerId: '' })).toEqual({
      taskId: ' tsk_1 ',
      blockerId: '',
    });
  },
);

test.each([1, 2_147_483_647])(
  'the lease schemas accept a lease of %d milliseconds',
  (leaseMs) => {
    expect(
      claimTaskSchema.parse({
        claimId: 'claim-1',
        assignees: ['dev'],
        actor: 'bot',
        leaseMs,
      }),
    ).toMatchObject({ leaseMs });
    expect(
      renewExecutionSchema.parse({ executionId: 'exe_1', leaseMs }),
    ).toEqual({ executionId: 'exe_1', leaseMs });
  },
);

test.each([0, 2_147_483_648, 1.5])(
  'the lease schemas refuse a lease of %d milliseconds',
  (leaseMs) => {
    expect(
      claimTaskSchema.safeParse({
        claimId: 'claim-1',
        assignees: ['dev'],
        actor: 'bot',
        leaseMs,
      }).success,
    ).toBe(false);
    expect(
      renewExecutionSchema.safeParse({ executionId: 'exe_1', leaseMs }).success,
    ).toBe(false);
  },
);

test('claimTaskSchema outputs the claim id, the assignees and the actor trimmed', () => {
  expect(
    claimTaskSchema.parse({
      claimId: ' claim-1 ',
      assignees: [' dev ', 'qa'],
      actor: ' runner-1 ',
      leaseMs: 30_000,
    }),
  ).toEqual({
    claimId: 'claim-1',
    assignees: ['dev', 'qa'],
    actor: 'runner-1',
    leaseMs: 30_000,
  });
});

test('finishTaskSchema outputs a finish with its texts trimmed and blank ones as null', () => {
  expect(
    finishTaskSchema.parse({
      executionId: 'exe_1',
      changedBy: ' bot-dev-1 ',
      status: Status.cancelled,
      reason: ' Done elsewhere. ',
      resultPath: '  ',
    }),
  ).toEqual({
    executionId: 'exe_1',
    changedBy: 'bot-dev-1',
    status: Status.cancelled,
    reason: 'Done elsewhere.',
    resultPath: null,
  });
});

test('cancelTaskSchema outputs a cancel with its texts trimmed and a blank reason as null', () => {
  expect(
    cancelTaskSchema.parse({
      id: 'tsk_1',
      changedBy: ' planner ',
      reason: ' ',
    }),
  ).toEqual({ id: 'tsk_1', changedBy: 'planner', reason: null });
});

test('assignTaskSchema outputs the assignee and who changed it trimmed', () => {
  expect(
    assignTaskSchema.parse({
      id: 'tsk_1',
      assignee: ' qa ',
      changedBy: ' planner ',
    }),
  ).toEqual({ id: 'tsk_1', assignee: 'qa', changedBy: 'planner' });
});

test('expireExecutionsSchema accepts one attempt or more, and refuses none', () => {
  expect(
    expireExecutionsSchema.parse({ maxAttempts: 1, changedBy: ' server ' }),
  ).toEqual({ maxAttempts: 1, changedBy: 'server' });
  expect(
    expireExecutionsSchema.safeParse({ maxAttempts: 0, changedBy: 'server' })
      .success,
  ).toBe(false);
});

test('listReadySchema outputs the assignees trimmed', () => {
  expect(
    listReadySchema.parse({ assignees: [' dev ', 'qa'], limit: 4 }),
  ).toEqual({ assignees: ['dev', 'qa'], limit: 4 });
});

test('listReadySchema accepts a limit past the safe integers', () => {
  expect(listReadySchema.parse({ assignees: ['dev'], limit: 1e20 })).toEqual({
    assignees: ['dev'],
    limit: 1e20,
  });
});
