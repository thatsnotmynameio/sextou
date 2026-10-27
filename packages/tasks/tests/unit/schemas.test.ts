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
  splitUses,
  tasksFileSchema,
  unlinkSchema,
} from '../../src/schemas';
import { Status } from '../../src/status';

// A full commit SHA.
const sha = '87dfc7f4f839d6e334ab1a1cdf6494c62499d9ff';

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
      uses: `org/app/Taskfile.yml@${sha}`,
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
    uses: `org/app/Taskfile.yml@${sha}`,
    createdBy: 'planner',
  });
});

test('createTaskSchema outputs null for a description, source path, context and uses left out', () => {
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
    uses: null,
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

/**
 * Parses a new task whose only optional field is its uses.
 * @param uses the uses, of any type
 */
function parseUses(uses: unknown) {
  return createTaskSchema.safeParse({
    title: 'A',
    kind: 'task',
    priority: 0,
    assignee: 'dev',
    uses,
    createdBy: 'planner',
  });
}

test('createTaskSchema accepts a uses naming a Taskfile at a full commit SHA, as given', () => {
  const uses = `thatsnotmynameio/sextou/packages/workflows/hello-world/Taskfile.yml@${sha}`;
  expect(parseUses(uses)).toMatchObject({ success: true, data: { uses } });
});

test.each([
  [
    'a repository whose name only starts with a dot',
    'org/.github/Taskfile.yml',
  ],
  ['a path whose segment only starts with ..', 'org/app/..hidden/Taskfile.yml'],
])('createTaskSchema accepts a uses with %s', (_name, path) => {
  expect(parseUses(`${path}@${sha}`).success).toBe(true);
});

test.each([
  ['a branch as its ref', 'org/app/Taskfile.yml@main'],
  ['a short SHA', 'org/app/Taskfile.yml@87dfc7f'],
  ['a SHA one digit short', `org/app/Taskfile.yml@${sha.slice(1)}`],
  ['a SHA one digit long', `org/app/Taskfile.yml@${sha}0`],
  ['uppercase hex', `org/app/Taskfile.yml@${sha.toUpperCase()}`],
  ['no @', `org/app/Taskfile.yml${sha}`],
  ['no ref after the @', 'org/app/Taskfile.yml@'],
  ['an owner of .', `./app/Taskfile.yml@${sha}`],
  ['an owner of ..', `../app/Taskfile.yml@${sha}`],
  ['a name of .', `org/./Taskfile.yml@${sha}`],
  ['a name of ..', `org/../Taskfile.yml@${sha}`],
  ['an empty owner', `/app/Taskfile.yml@${sha}`],
  ['an empty name', `org//Taskfile.yml@${sha}`],
  ['an owner a URL would not take', `o rg/app/Taskfile.yml@${sha}`],
  ['an empty segment in the path', `org/app/ci//Taskfile.yml@${sha}`],
  ['a . segment in the path', `org/app/./Taskfile.yml@${sha}`],
  ['a .. segment in the path', `org/app/ci/../Taskfile.yml@${sha}`],
  ['a trailing slash', `org/app/ci/@${sha}`],
  ['no path after owner/name', `org/app@${sha}`],
  ['an empty path after owner/name', `org/app/@${sha}`],
  ['only owner/name', `org@${sha}`],
  ['a leading slash', `/org/app/Taskfile.yml@${sha}`],
  ['an empty string', ''],
  ['a number', 7],
  ['null', null],
])('createTaskSchema refuses a uses with %s', (_name, uses) => {
  expect(parseUses(uses).success).toBe(false);
});

test('splitUses splits a uses into its repository, its commit and its Taskfile', () => {
  expect(
    splitUses(
      `thatsnotmynameio/sextou/packages/workflows/hello-world/Taskfile.yml@${sha}`,
    ),
  ).toEqual({
    repo: 'thatsnotmynameio/sextou',
    sha,
    taskfile: 'packages/workflows/hello-world/Taskfile.yml',
  });
});

test('splitUses splits a uses whose path holds an @ at its last @', () => {
  expect(splitUses(`org/app/ci@v1/Taskfile.yml@${sha}`)).toEqual({
    repo: 'org/app',
    sha,
    taskfile: 'ci@v1/Taskfile.yml',
  });
});

// A regex that splits at the last @ backtracks over every @ when the text
// ends in a line terminator, taking time quadratic in the @s.
test('createTaskSchema refuses a uses of 100,000 @ and a line terminator in linear time', () => {
  expect(parseUses(`a/b/${'@'.repeat(100_000)}\n`).success).toBe(false);
});

test('splitUses returns null for a uses it refuses', () => {
  expect(splitUses('org/app/Taskfile.yml@main')).toBeNull();
});

// A task of a file with only the fields it requires.
const fileTask = {
  key: 'lint',
  title: 'Lint',
  kind: 'review',
  priority: 2,
  assignee: 'dev',
};

test('tasksFileSchema outputs a task with every field, its texts trimmed', () => {
  expect(
    tasksFileSchema.parse({
      tasks: [
        {
          key: ' synthesize ',
          title: ' Synthesize ',
          kind: ' review ',
          priority: 1,
          assignee: ' dev ',
          description: ' Merge the verdicts. ',
          source: ' ./notes/review.md ',
          context: { pr: 117 },
          uses: `org/app/Taskfile.yml@${sha}`,
          blockedBy: [' lint ', 'test'],
        },
      ],
    }),
  ).toEqual({
    tasks: [
      {
        key: 'synthesize',
        title: 'Synthesize',
        kind: 'review',
        priority: 1,
        assignee: 'dev',
        description: 'Merge the verdicts.',
        source: './notes/review.md',
        context: { pr: 117 },
        uses: `org/app/Taskfile.yml@${sha}`,
        blockedBy: ['lint', 'test'],
      },
    ],
  });
});

test('tasksFileSchema outputs null for a description, source, context and uses left out, and no blockers', () => {
  expect(tasksFileSchema.parse({ tasks: [fileTask] })).toEqual({
    tasks: [
      {
        ...fileTask,
        description: null,
        source: null,
        context: null,
        uses: null,
      },
    ],
  });
});

test('tasksFileSchema accepts a file with no tasks', () => {
  expect(tasksFileSchema.parse({ tasks: [] })).toEqual({ tasks: [] });
});

test.each([
  ['a field its format does not define', { blocked_by: ['test'] }],
  ['a parent', { parentId: 'tsk_1' }],
  ['a creator', { createdBy: 'planner' }],
  ['a source path, which it names source', { sourcePath: './notes.md' }],
])('tasksFileSchema refuses a task with %s', (_name, field) => {
  expect(
    tasksFileSchema.safeParse({ tasks: [{ ...fileTask, ...field }] }).success,
  ).toBe(false);
});

test('tasksFileSchema refuses a file with a field its format does not define', () => {
  expect(
    tasksFileSchema.safeParse({ tasks: [fileTask], version: 1 }).success,
  ).toBe(false);
});

test.each([
  ['no key', { key: undefined }],
  ['a blank key', { key: ' ' }],
  ['a blank blocker key', { blockedBy: [' '] }],
  ['a uses whose ref is not a full commit SHA', { uses: 'org/app/T.yml@main' }],
  ['a context that is not an object', { context: ['a'] }],
  ['a priority past 4', { priority: 5 }],
])('tasksFileSchema refuses a task with %s', (_name, field) => {
  expect(
    tasksFileSchema.safeParse({ tasks: [{ ...fileTask, ...field }] }).success,
  ).toBe(false);
});

test('tasksFileSchema refuses a file without its tasks', () => {
  expect(tasksFileSchema.safeParse({}).success).toBe(false);
});

// A finish of a run that succeeded.
const finish = {
  executionId: 'exe_1',
  changedBy: 'bot-dev-1',
  status: Status.succeeded,
};

test('finishTaskSchema outputs a finish with its tasks text and both limits', () => {
  expect(
    finishTaskSchema.parse({
      ...finish,
      tasks: ' {"tasks":[]} ',
      maxTasks: 50,
      maxDepth: 20,
    }),
  ).toEqual({
    ...finish,
    reason: null,
    resultPath: null,
    tasks: ' {"tasks":[]} ',
    maxTasks: 50,
    maxDepth: 20,
  });
});

test('finishTaskSchema accepts limits without a tasks text', () => {
  expect(
    finishTaskSchema.parse({ ...finish, maxTasks: 1, maxDepth: 1 }),
  ).toMatchObject({ maxTasks: 1, maxDepth: 1 });
});

test.each([
  ['no limits', {}],
  ['no maxTasks', { maxDepth: 20 }],
  ['no maxDepth', { maxTasks: 50 }],
])('finishTaskSchema refuses a tasks text with %s', (_name, limits) => {
  expect(
    finishTaskSchema.safeParse({ ...finish, tasks: '', ...limits }).success,
  ).toBe(false);
});

test.each([
  ['maxTasks of 0', { maxTasks: 0, maxDepth: 20 }],
  ['maxDepth of 0', { maxTasks: 50, maxDepth: 0 }],
  ['maxTasks of 1.5', { maxTasks: 1.5, maxDepth: 20 }],
])('finishTaskSchema refuses %s', (_name, limits) => {
  expect(
    finishTaskSchema.safeParse({ ...finish, tasks: '', ...limits }).success,
  ).toBe(false);
  expect(finishTaskSchema.safeParse({ ...finish, ...limits }).success).toBe(
    false,
  );
});

test('finishTaskSchema refuses a tasks text that is not text', () => {
  expect(
    finishTaskSchema.safeParse({
      ...finish,
      tasks: { tasks: [] },
      maxTasks: 50,
      maxDepth: 20,
    }).success,
  ).toBe(false);
});
