// The tasks service runs @sextou/tasks for real, two sextou packages
// together, so its tests are integration tests and no unit test answers for
// it, even on ':memory:'.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTasks } from '@sextou/tasks';
import { connect } from '@tursodatabase/database';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createLogger } from '../../../src/logger';
import {
  createTasksService,
  type NewTask,
  Outcome,
  Refusal,
  Status,
  type Task,
  type TasksService,
} from '../../../src/modules/tasks';

const dev = { name: 'dev' };
const alice = { name: 'alice' };
const planner = { name: 'planner' };
const unknownId = `tsk_${'0'.repeat(32)}`;
const logger = createLogger({ level: 'silent', pretty: false });

let dir: string;
const services: TasksService[] = [];

// A started service, stopped after the test.
async function startedService(path = ':memory:') {
  const tasks = createTasksService(path, { logger });
  services.push(tasks);
  await tasks.start();
  return tasks;
}

function newTask(fields: Partial<NewTask> = {}): NewTask {
  return {
    title: 'Write the tests',
    kind: 'task',
    priority: 2,
    assignee: dev,
    createdBy: planner,
    ...fields,
  };
}

async function createOpen(
  tasks: TasksService,
  fields: Partial<NewTask> = {},
): Promise<Task> {
  const result = await tasks.create(newTask(fields));
  if (!result.ok) {
    throw new Error(`create refused: ${result.refusal}`);
  }
  return result.task;
}

async function createRunning(tasks: TasksService): Promise<Task> {
  const task = await createOpen(tasks);
  const result = await tasks.take({ taskId: task.id, actor: dev });
  if (!result.ok) {
    throw new Error(`take refused: ${result.refusal}`);
  }
  return task;
}

// A row of the tasks database's file, read once the service stopped.
async function readRow(path: string, sql: string, ...params: string[]) {
  const client = await connect(path);
  try {
    return await client.get(sql, ...params);
  } finally {
    await client.close();
  }
}

// A path holding a file that is not a database, which start rejects.
function notADatabase() {
  const path = join(dir, 'tasks.db');
  writeFileSync(path, 'not a database, just some text that is long enough');
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-tasks-service-'));
});

afterEach(async () => {
  await Promise.all(services.splice(0).map((tasks) => tasks.stop()));
  rmSync(dir, { recursive: true, force: true });
});

test('start on a file creates the file and its missing folder', async () => {
  const path = join(dir, 'data', 'tasks.db');

  await startedService(path);

  expect(existsSync(path)).toBe(true);
});

test('start a second time keeps the tasks database it opened', async () => {
  const tasks = await startedService();
  const task = await createOpen(tasks);

  await tasks.start();

  expect(await tasks.next([dev])).toEqual({ ok: true, task });
});

test('start rejects when the file is not a database', async () => {
  const tasks = createTasksService(notADatabase(), { logger });
  services.push(tasks);

  await expect(tasks.start()).rejects.toThrow();
});

test('after a failed start, each call rejects with the error start rejected with', async () => {
  const tasks = createTasksService(notADatabase(), { logger });
  services.push(tasks);
  const error: unknown = await tasks.start().catch((error: unknown) => error);

  await expect(tasks.create(newTask())).rejects.toBe(error);
  await expect(tasks.next([dev])).rejects.toBe(error);
  await expect(tasks.take({ taskId: unknownId, actor: dev })).rejects.toBe(
    error,
  );
  await expect(
    tasks.finish({ taskId: unknownId, actor: dev, outcome: Outcome.failed }),
  ).rejects.toBe(error);
});

test('stop after a failed start resolves', async () => {
  const tasks = createTasksService(notADatabase(), { logger });
  await tasks.start().catch(() => undefined);

  await expect(tasks.stop()).resolves.toBeUndefined();
});

test('a call before start rejects, saying the service is not started', async () => {
  const tasks = createTasksService(':memory:', { logger });

  await expect(tasks.create(newTask())).rejects.toThrow(
    'The tasks service is not started',
  );
});

test('stop before start resolves', async () => {
  await expect(
    createTasksService(':memory:', { logger }).stop(),
  ).resolves.toBeUndefined();
});

test('a call after stop rejects', async () => {
  const tasks = await startedService();
  await tasks.stop();

  await expect(tasks.create(newTask())).rejects.toThrow();
});

test('stop a second time resolves', async () => {
  const tasks = await startedService();
  await tasks.stop();

  await expect(tasks.stop()).resolves.toBeUndefined();
});

test('create returns the open task it created, with the fields it was given', async () => {
  const tasks = await startedService();

  const result = await tasks.create(
    newTask({
      priority: 1,
      description: 'Cover the service',
      source: '/specs/tests.md',
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
      assignee: dev,
      description: 'Cover the service',
      source: '/specs/tests.md',
      status: Status.open,
    },
  });
});

test('create keeps the parent it was given', async () => {
  const tasks = await startedService();
  const parent = await createOpen(tasks);

  expect(await tasks.create(newTask({ parentId: parent.id }))).toMatchObject({
    ok: true,
    task: { parentId: parent.id },
  });
});

test('create records who created the task', async () => {
  const path = join(dir, 'tasks.db');
  const tasks = await startedService(path);
  const task = await createOpen(tasks, { createdBy: planner });
  await tasks.stop();

  expect(
    await readRow(
      path,
      'SELECT changed_by FROM task_status_changes WHERE task_id = ?',
      task.id,
    ),
  ).toEqual({ changed_by: 'planner' });
});

test('create refuses a blank title as invalid', async () => {
  const tasks = await startedService();

  expect(await tasks.create(newTask({ title: ' ' }))).toEqual({
    ok: false,
    refusal: Refusal.invalid,
  });
});

test('create refuses an unknown parent as not_found', async () => {
  const tasks = await startedService();

  expect(await tasks.create(newTask({ parentId: unknownId }))).toEqual({
    ok: false,
    refusal: Refusal.notFound,
  });
});

test('next returns the most urgent ready task among the actors given', async () => {
  const tasks = await startedService();
  const urgent = await createOpen(tasks, { priority: 0, assignee: dev });
  await createOpen(tasks, { priority: 2, assignee: alice });

  expect(await tasks.next([alice, dev])).toEqual({ ok: true, task: urgent });
});

test('next returns the older of two ready tasks at the same priority', async () => {
  const tasks = await startedService();
  const older = await createOpen(tasks, { title: 'First' });
  await createOpen(tasks, { title: 'Second' });

  expect(await tasks.next([dev])).toEqual({ ok: true, task: older });
});

test('next returns a null task when none is ready for the actors given', async () => {
  const tasks = await startedService();
  await createOpen(tasks, { assignee: dev });

  expect(await tasks.next([alice])).toEqual({ ok: true, task: null });
});

test('next leaves out a running task', async () => {
  const tasks = await startedService();
  await createRunning(tasks);

  expect(await tasks.next([dev])).toEqual({ ok: true, task: null });
});

test('next refuses an empty list of actors as invalid', async () => {
  const tasks = await startedService();

  expect(await tasks.next([])).toEqual({ ok: false, refusal: Refusal.invalid });
});

test('take moves the task to running, its assignee unchanged', async () => {
  const path = join(dir, 'tasks.db');
  const tasks = await startedService(path);
  const task = await createOpen(tasks, { assignee: dev });

  const result = await tasks.take({ taskId: task.id, actor: alice });
  await tasks.stop();

  expect(result).toEqual({ ok: true });
  expect(
    await readRow(
      path,
      'SELECT status, assignee FROM tasks WHERE id = ?',
      task.id,
    ),
  ).toEqual({ status: Status.running, assignee: 'dev' });
});

test('take records the actor as who runs the task and as who started it', async () => {
  const path = join(dir, 'tasks.db');
  const tasks = await startedService(path);
  const task = await createOpen(tasks, { assignee: dev });

  await tasks.take({ taskId: task.id, actor: alice });
  await tasks.stop();

  expect(
    await readRow(
      path,
      "SELECT e.actor, c.changed_by FROM task_executions e JOIN task_status_changes c ON c.task_id = e.task_id AND c.to_status = 'running' WHERE e.task_id = ?",
      task.id,
    ),
  ).toEqual({ actor: 'alice', changed_by: 'alice' });
});

// The database is seeded through the library, since the service can't link
// tasks.
test('a task take refused as blocked comes back as next once its blocker succeeds', async () => {
  const path = join(dir, 'tasks.db');
  const seed = await openTasks(path, { logger });
  const ids: string[] = [];
  for (const title of ['Blocker', 'Blocked']) {
    const result = await seed.createTask({
      title,
      kind: 'task',
      priority: 2,
      assignee: 'dev',
      createdBy: 'planner',
    });
    if (!result.ok) {
      throw new Error(`createTask refused: ${result.reason}`);
    }
    ids.push(result.task.id);
  }
  const [blockerId, taskId] = ids;
  await seed.link({ taskId, blockerId });
  await seed.close();
  const tasks = await startedService(path);

  const result = await tasks.take({ taskId, actor: dev });

  expect(result).toEqual({ ok: false, refusal: Refusal.blocked });
  await tasks.take({ taskId: blockerId, actor: dev });
  await tasks.finish({
    taskId: blockerId,
    actor: dev,
    outcome: Outcome.succeeded,
  });
  expect(await tasks.next([dev])).toMatchObject({
    ok: true,
    task: { id: taskId, status: Status.open },
  });
});

test('take refuses an unknown task as not_found', async () => {
  const tasks = await startedService();

  expect(await tasks.take({ taskId: unknownId, actor: dev })).toEqual({
    ok: false,
    refusal: Refusal.notFound,
  });
});

test('take refuses a running task as not_open', async () => {
  const tasks = await startedService();
  const task = await createRunning(tasks);

  expect(await tasks.take({ taskId: task.id, actor: dev })).toEqual({
    ok: false,
    refusal: Refusal.notOpen,
  });
});

test('take refuses a blank actor as invalid', async () => {
  const tasks = await startedService();
  const task = await createOpen(tasks);

  expect(await tasks.take({ taskId: task.id, actor: { name: ' ' } })).toEqual({
    ok: false,
    refusal: Refusal.invalid,
  });
});

test.each(Object.values(Outcome))(
  'finish moves a running task to %s',
  async (outcome) => {
    const path = join(dir, 'tasks.db');
    const tasks = await startedService(path);
    const task = await createRunning(tasks);

    const result = await tasks.finish({ taskId: task.id, actor: dev, outcome });
    await tasks.stop();

    expect(result).toEqual({ ok: true });
    expect(
      await readRow(path, 'SELECT status FROM tasks WHERE id = ?', task.id),
    ).toEqual({ status: outcome });
  },
);

test('finish records the actor as who finished the task, with the reason given', async () => {
  const path = join(dir, 'tasks.db');
  const tasks = await startedService(path);
  const task = await createRunning(tasks);

  await tasks.finish({
    taskId: task.id,
    actor: alice,
    outcome: Outcome.failed,
    reason: 'The tests time out',
  });
  await tasks.stop();

  expect(
    await readRow(
      path,
      "SELECT changed_by, reason FROM task_status_changes WHERE task_id = ? AND to_status = 'failed'",
      task.id,
    ),
  ).toEqual({ changed_by: 'alice', reason: 'The tests time out' });
});

test('finish refuses an open task as not_running', async () => {
  const tasks = await startedService();
  const task = await createOpen(tasks);

  expect(
    await tasks.finish({
      taskId: task.id,
      actor: dev,
      outcome: Outcome.succeeded,
    }),
  ).toEqual({ ok: false, refusal: Refusal.notRunning });
});

test('finish refuses an unknown task as not_found', async () => {
  const tasks = await startedService();

  expect(
    await tasks.finish({
      taskId: unknownId,
      actor: dev,
      outcome: Outcome.succeeded,
    }),
  ).toEqual({ ok: false, refusal: Refusal.notFound });
});
