import { expect, test, vi } from 'vitest';
import { tasksRouter } from '../../../../src/modules/tasks/tasks.router';
import { Refusal, Status, type Tasks } from '../../../../src/tasks';
import { createCallerFactory } from '../../../../src/trpc';
import { aTask, fakeTasks, testContext } from '../../../tasks';

const createCaller = createCallerFactory(tasksRouter);

function caller(tasks: Partial<Tasks>) {
  return createCaller(testContext({ tasks: fakeTasks(tasks) }));
}

const task = aTask();

test('tasks.create creates the task with the names it was given', async () => {
  const child = { ...task, parentId: 'tsk_0' };
  const create = vi.fn(async () => ({ ok: true as const, task: child }));

  expect(
    await caller({ create }).create({
      title: 'Write the tests',
      kind: 'task',
      priority: 2,
      parentId: 'tsk_0',
      assignee: ' dev ',
      description: 'Cover it',
      source: '/specs/tests.md',
      createdBy: 'planner',
    }),
  ).toEqual(child);
  expect(create).toHaveBeenCalledWith({
    title: 'Write the tests',
    kind: 'task',
    priority: 2,
    parentId: 'tsk_0',
    assignee: { name: 'dev' },
    description: 'Cover it',
    source: '/specs/tests.md',
    createdBy: { name: 'planner' },
  });
});

test.each([
  [Refusal.invalid, 'BAD_REQUEST'],
  [Refusal.notFound, 'NOT_FOUND'],
] as const)(
  'tasks.create turns the refusal %s into %s',
  async (refusal, code) => {
    await expect(
      caller({ create: async () => ({ ok: false, refusal }) }).create({
        title: 'A',
        kind: 'task',
        priority: 2,
        assignee: 'dev',
        createdBy: 'planner',
      }),
    ).rejects.toMatchObject({ code, message: refusal });
  },
);

test.each([5, -1, 1.5])(
  'tasks.create refuses priority %d as BAD_REQUEST',
  async (priority) => {
    await expect(
      caller({}).create({
        title: 'A',
        kind: 'task',
        priority: priority as never,
        assignee: 'dev',
        createdBy: 'planner',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  },
);

test.each([Status.cancelled, Status.running] as const)(
  'tasks.cancel answers the task %s after the cancel',
  async (status) => {
    const cancel = vi.fn(async () => ({ ok: true as const, status }));

    expect(
      await caller({ cancel }).cancel({
        taskId: 'tsk_1',
        actor: 'planner',
        reason: 'dup',
      }),
    ).toEqual({ status });
    expect(cancel).toHaveBeenCalledWith({
      taskId: 'tsk_1',
      actor: { name: 'planner' },
      reason: 'dup',
    });
  },
);

test.each([
  [Refusal.invalid, 'BAD_REQUEST'],
  [Refusal.notFound, 'NOT_FOUND'],
  [Refusal.alreadyFinished, 'CONFLICT'],
] as const)(
  'tasks.cancel turns the refusal %s into %s',
  async (refusal, code) => {
    await expect(
      caller({ cancel: async () => ({ ok: false, refusal }) }).cancel({
        taskId: 'tsk_1',
        actor: 'planner',
      }),
    ).rejects.toMatchObject({ code, message: refusal });
  },
);

test('tasks.assign hands the task to the assignee given', async () => {
  const assign = vi.fn(async () => ({ ok: true as const }));

  expect(
    await caller({ assign }).assign({
      taskId: 'tsk_1',
      assignee: 'qa',
      actor: 'planner',
    }),
  ).toBeNull();
  expect(assign).toHaveBeenCalledWith({
    taskId: 'tsk_1',
    assignee: { name: 'qa' },
    actor: { name: 'planner' },
  });
});

test.each([
  [Refusal.invalid, 'BAD_REQUEST'],
  [Refusal.notFound, 'NOT_FOUND'],
  [Refusal.notOpen, 'CONFLICT'],
] as const)(
  'tasks.assign turns the refusal %s into %s',
  async (refusal, code) => {
    await expect(
      caller({ assign: async () => ({ ok: false, refusal }) }).assign({
        taskId: 'tsk_1',
        assignee: 'qa',
        actor: 'planner',
      }),
    ).rejects.toMatchObject({ code, message: refusal });
  },
);

test.each([
  { taskId: '', assignee: 'qa', actor: 'planner' },
  { taskId: 'tsk_1', assignee: ' ', actor: 'planner' },
  { taskId: 'tsk_1', assignee: 'qa', actor: '' },
])('tasks.assign refuses %j as BAD_REQUEST', async (input) => {
  await expect(caller({}).assign(input)).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
});
