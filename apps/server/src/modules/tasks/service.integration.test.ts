// The tasks module runs @sextou/tasks for real, two sextou packages
// together, so its tests are integration tests and no unit test answers for
// it, even on ':memory:'.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type NewTask, openTasks, type Task } from '@sextou/tasks';
import { connect } from '@tursodatabase/database';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { initTasks } from './index';
import type { TasksService } from './service';

let dir: string;
const opened: TasksService[] = [];

async function init(path = ':memory:') {
  const service = await initTasks(path);
  opened.push(service);
  return service;
}

function newTask(fields: Partial<NewTask> = {}): NewTask {
  return {
    title: 'Write the tests',
    kind: 'task',
    priority: 2,
    assignee: 'dev',
    createdBy: 'planner',
    ...fields,
  };
}

async function created(
  service: TasksService,
  fields: Partial<NewTask> = {},
): Promise<Task> {
  const result = await service.createTask(newTask(fields));
  if (!result.ok) {
    throw new Error(`createTask refused: ${result.reason}`);
  }
  return result.task;
}

async function started(service: TasksService, id: string) {
  const result = await service.startTask({
    id,
    changedBy: 'dev',
    actor: 'dev',
  });
  if (!result.ok) {
    throw new Error(`startTask refused: ${result.reason}`);
  }
}

// A row from the task graph's file, read once the service closed it.
async function stored(path: string, sql: string, ...params: string[]) {
  const client = await connect(path);
  try {
    return await client.get(sql, ...params);
  } finally {
    await client.close();
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-tasks-service-'));
});

afterEach(async () => {
  await Promise.all(opened.splice(0).map((service) => service.close()));
  rmSync(dir, { recursive: true, force: true });
});

test('createTask returns the open task it created, with the fields it was given', async () => {
  const service = await init();

  const result = await service.createTask(
    newTask({
      priority: 1,
      description: 'Cover the service',
      sourcePath: '/specs/tests.md',
    }),
  );

  expect(result).toEqual({
    ok: true,
    task: {
      id: expect.stringMatching(/^tsk_[0-9a-f]{32}$/),
      title: 'Write the tests',
      kind: 'task',
      priority: 1,
      parentId: null,
      assignee: 'dev',
      description: 'Cover the service',
      sourcePath: '/specs/tests.md',
      status: 'open',
    },
  });
});

test('createTask returns the invalid refusal for a blank title', async () => {
  const service = await init();

  expect(await service.createTask(newTask({ title: ' ' }))).toEqual({
    ok: false,
    reason: 'invalid',
  });
});

test('createTask returns the not_found refusal for an unknown parent', async () => {
  const service = await init();

  expect(
    await service.createTask(newTask({ parentId: `tsk_${'0'.repeat(32)}` })),
  ).toEqual({ ok: false, reason: 'not_found' });
});

test('createTask takes any name as the assignee and the creator, unchecked', async () => {
  const service = await init();

  const result = await service.createTask(
    newTask({ assignee: 'nobody has this name', createdBy: '?' }),
  );

  expect(result).toMatchObject({
    ok: true,
    task: { assignee: 'nobody has this name' },
  });
});

// Covers AE2.
test('nextTask returns the most urgent ready task among the names given', async () => {
  const service = await init();
  const urgent = await created(service, { priority: 0, assignee: 'dev' });
  await created(service, { priority: 2, assignee: 'alice' });

  expect(await service.nextTask(['alice', 'dev'])).toEqual({
    ok: true,
    task: urgent,
  });
});

test('nextTask returns the older of two ready tasks at the same priority', async () => {
  const service = await init();
  const older = await created(service, { title: 'First' });
  await created(service, { title: 'Second' });

  expect(await service.nextTask(['dev'])).toEqual({ ok: true, task: older });
});

// Covers AE3.
test('nextTask returns a null task when none is ready for the names given', async () => {
  const service = await init();
  await created(service, { assignee: 'dev' });

  expect(await service.nextTask(['alice'])).toEqual({ ok: true, task: null });
});

test('nextTask returns the invalid refusal for an empty list of names', async () => {
  const service = await init();

  expect(await service.nextTask([])).toEqual({ ok: false, reason: 'invalid' });
});

test('nextTask leaves out a running task', async () => {
  const service = await init();
  const task = await created(service);
  await started(service, task.id);

  expect(await service.nextTask(['dev'])).toEqual({ ok: true, task: null });
});

// Covers AE4.
test('startTask runs the task as its actor and keeps its assignee', async () => {
  const path = join(dir, 'tasks.db');
  const service = await init(path);
  const task = await created(service, { assignee: 'dev' });

  const result = await service.startTask({
    id: task.id,
    changedBy: 'planner',
    actor: 'alice',
    logPath: '/logs/run.log',
  });
  await service.close();

  expect(result).toEqual({ ok: true });
  expect(
    await stored(
      path,
      'SELECT status, assignee FROM tasks WHERE id = ?',
      task.id,
    ),
  ).toEqual({ status: 'running', assignee: 'dev' });
  expect(
    await stored(
      path,
      'SELECT actor, log_path FROM task_executions WHERE task_id = ?',
      task.id,
    ),
  ).toEqual({ actor: 'alice', log_path: '/logs/run.log' });
});

// Covers AE5. The graph is seeded through the library, since the service has
// no way to link tasks.
test('startTask returns the blocked refusal for a blocked task, which stays open', async () => {
  const path = join(dir, 'tasks.db');
  const seed = await openTasks(path);
  const ids: string[] = [];
  for (const title of ['Blocker', 'Blocked']) {
    const result = await seed.createTask(newTask({ title }));
    if (!result.ok) {
      throw new Error(`createTask refused: ${result.reason}`);
    }
    ids.push(result.task.id);
  }
  const [blockerId, taskId] = ids;
  await seed.link({ taskId, blockerId });
  await seed.close();
  const service = await init(path);

  const result = await service.startTask({
    id: taskId,
    changedBy: 'dev',
    actor: 'dev',
  });

  expect(result).toEqual({ ok: false, reason: 'blocked' });
  await started(service, blockerId);
  await service.finishTask({
    id: blockerId,
    changedBy: 'dev',
    status: 'succeeded',
  });
  expect(await service.nextTask(['dev'])).toMatchObject({
    ok: true,
    task: { id: taskId, status: 'open' },
  });
});

test('startTask returns the not_found refusal for an unknown task', async () => {
  const service = await init();

  expect(
    await service.startTask({
      id: `tsk_${'0'.repeat(32)}`,
      changedBy: 'dev',
      actor: 'dev',
    }),
  ).toEqual({ ok: false, reason: 'not_found' });
});

test('startTask returns the not_open refusal for a running task', async () => {
  const service = await init();
  const task = await created(service);
  await started(service, task.id);

  expect(
    await service.startTask({ id: task.id, changedBy: 'dev', actor: 'dev' }),
  ).toEqual({ ok: false, reason: 'not_open' });
});

test.each(['succeeded', 'failed', 'skipped'] as const)(
  'finishTask moves a running task to %s',
  async (status) => {
    const path = join(dir, 'tasks.db');
    const service = await init(path);
    const task = await created(service);
    await started(service, task.id);

    const result = await service.finishTask({
      id: task.id,
      changedBy: 'dev',
      status,
    });
    await service.close();

    expect(result).toEqual({ ok: true });
    expect(
      await stored(path, 'SELECT status FROM tasks WHERE id = ?', task.id),
    ).toEqual({ status });
  },
);

test('finishTask returns the not_running refusal for an open task', async () => {
  const service = await init();
  const task = await created(service);

  expect(
    await service.finishTask({
      id: task.id,
      changedBy: 'dev',
      status: 'succeeded',
    }),
  ).toEqual({ ok: false, reason: 'not_running' });
});

// A closed graph is one way to make the library reject rather than refuse.
test('createTask rejects when the library rejects', async () => {
  const service = await init();
  await service.close();

  await expect(service.createTask(newTask())).rejects.toThrow();
});

test('close resolves a second time', async () => {
  const service = await init();
  await service.close();

  await expect(service.close()).resolves.toBeUndefined();
});
