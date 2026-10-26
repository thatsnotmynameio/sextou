// The tasks service runs @sextou/tasks for real, two sextou packages
// together, so its tests are integration tests and no unit test answers for
// it, even on ':memory:'.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTasks } from '@sextou/tasks';
import { connect } from '@tursodatabase/database';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createLogger } from '../../src/logger';
import {
  type NewTask,
  Outcome,
  Refusal,
  Status,
  type Task,
} from '../../src/tasks';
import {
  createTasksService,
  type TasksService,
  type TasksServiceOptions,
} from '../../src/tasks-service';

const dev = { name: 'dev' };
const alice = { name: 'alice' };
const planner = { name: 'planner' };
const runner = { name: 'runner-1' };
const server = { name: 'server' };
const unknownId = `tsk_${'0'.repeat(32)}`;
const logger = createLogger({ level: 'silent', pretty: false });
const leaseMs = 30_000;

// A claim id no claim used before.
let claims = 0;
const newClaim = () => `claim-${(claims += 1)}`;

let dir: string;
const services: TasksService[] = [];

function service(
  path = ':memory:',
  options: Partial<TasksServiceOptions> = {},
) {
  const tasks = createTasksService(path, {
    logger,
    leaseMs,
    maxAttempts: 1,
    timeoutMs: 20_000,
    ...options,
  });
  services.push(tasks);
  return tasks;
}

// A started service, stopped after the test.
async function startedService(
  path = ':memory:',
  options: Partial<TasksServiceOptions> = {},
) {
  const tasks = service(path, options);
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

// Claims the only ready task of dev, and returns its attempt's id.
async function claimed(tasks: TasksService) {
  const result = await tasks.claim({
    claimId: newClaim(),
    runner,
    assignees: [dev],
  });
  if (!result.ok || result.task === null) {
    throw new Error('claim found no task');
  }
  return result.execution.id;
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
  vi.restoreAllMocks();
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

  expect(
    await tasks.claim({ claimId: newClaim(), runner, assignees: [dev] }),
  ).toMatchObject({
    ok: true,
    task: { id: task.id },
  });
});

test('start rejects when the file is not a database', async () => {
  const tasks = service(notADatabase());

  await expect(tasks.start()).rejects.toThrow();
});

test('start reads the migrations from the folder it was given', async () => {
  const tasks = service(':memory:', { migrationsFolder: join(dir, 'missing') });

  await expect(tasks.start()).rejects.toThrow(join(dir, 'missing'));
});

test('after a failed start, each call rejects with the error start rejected with', async () => {
  const tasks = service(notADatabase());
  const error: unknown = await tasks.start().catch((error: unknown) => error);

  await expect(tasks.create(newTask())).rejects.toBe(error);
  await expect(
    tasks.claim({ claimId: newClaim(), runner, assignees: [dev] }),
  ).rejects.toBe(error);
  await expect(tasks.renew('exe_1')).rejects.toBe(error);
  await expect(
    tasks.finish({ executionId: 'exe_1', runner, outcome: Outcome.failed }),
  ).rejects.toBe(error);
  await expect(tasks.cancel({ taskId: unknownId, actor: dev })).rejects.toBe(
    error,
  );
  await expect(
    tasks.assign({ taskId: unknownId, assignee: alice, actor: dev }),
  ).rejects.toBe(error);
  await expect(tasks.expire(server)).rejects.toBe(error);
});

test('stop after a failed start resolves', async () => {
  const tasks = service(notADatabase());
  await tasks.start().catch(() => undefined);

  await expect(tasks.stop()).resolves.toBeUndefined();
});

test('a call before start rejects, saying the service is not started', async () => {
  const tasks = service();

  await expect(tasks.create(newTask())).rejects.toThrow(
    'The tasks service is not started',
  );
});

test('stop before start resolves', async () => {
  await expect(service().stop()).resolves.toBeUndefined();
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
      context: { repo: 'org/app', commit: { sha: 'abc' } },
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
      context: { repo: 'org/app', commit: { sha: 'abc' } },
      status: Status.open,
    },
  });
});

test('create without a context returns the task with a null context', async () => {
  const tasks = await startedService();

  expect(await tasks.create(newTask())).toMatchObject({
    ok: true,
    task: { context: null },
  });
});

test('create refuses a context nested deeper than 500 levels as invalid', async () => {
  const tasks = await startedService();
  let deep: Record<string, unknown> = {};
  for (let level = 0; level < 500; level += 1) {
    deep = { deep };
  }

  expect(await tasks.create(newTask({ context: deep }))).toEqual({
    ok: false,
    refusal: Refusal.invalid,
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

test('claim hands the runner the most urgent ready task of its assignees, running, with the lease it holds', async () => {
  const tasks = await startedService();
  const urgent = await createOpen(tasks, { priority: 0, assignee: dev });
  await createOpen(tasks, { priority: 2, assignee: alice });

  expect(
    await tasks.claim({ claimId: newClaim(), runner, assignees: [alice, dev] }),
  ).toEqual({
    ok: true,
    task: { ...urgent, status: Status.running },
    execution: {
      id: expect.stringMatching(/^exe_[0-9a-f]{32}$/),
      attempt: 1,
      leaseMs,
    },
  });
});

test('claim returns a null task when none is ready for the assignees given', async () => {
  const tasks = await startedService();
  await createOpen(tasks, { assignee: dev });

  expect(
    await tasks.claim({ claimId: newClaim(), runner, assignees: [alice] }),
  ).toEqual({
    ok: true,
    task: null,
  });
});

test('claim records the runner as who runs the task and as who started it', async () => {
  const path = join(dir, 'tasks.db');
  const tasks = await startedService(path);
  const task = await createOpen(tasks);

  await claimed(tasks);
  await tasks.stop();

  expect(
    await readRow(
      path,
      "SELECT e.actor, c.changed_by FROM task_executions e JOIN task_status_changes c ON c.task_id = e.task_id AND c.to_status = 'running' WHERE e.task_id = ?",
      task.id,
    ),
  ).toEqual({ actor: 'runner-1', changed_by: 'runner-1' });
});

test('claim refuses an empty list of assignees as invalid', async () => {
  const tasks = await startedService();

  expect(
    await tasks.claim({ claimId: newClaim(), runner, assignees: [] }),
  ).toEqual({
    ok: false,
    refusal: Refusal.invalid,
  });
});

// The database is seeded through the library, since the service can't link
// tasks.
test('claim skips a blocked task until its blocker succeeds', async () => {
  const path = join(dir, 'tasks.db');
  const seed = await openTasks(path, { logger });
  const ids: string[] = [];
  for (const [title, priority] of [
    ['Blocker', 2],
    ['Blocked', 0],
  ] as const) {
    const result = await seed.createTask({
      title,
      kind: 'task',
      priority,
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

  const first = await tasks.claim({
    claimId: newClaim(),
    runner,
    assignees: [dev],
  });

  expect(first).toMatchObject({ task: { id: blockerId } });
  if (!first.ok || first.task === null) {
    throw new Error('no task claimed');
  }
  await tasks.finish({
    executionId: first.execution.id,
    runner,
    outcome: Outcome.succeeded,
  });
  expect(
    await tasks.claim({ claimId: newClaim(), runner, assignees: [dev] }),
  ).toMatchObject({
    task: { id: taskId },
  });
});

test('renew pushes the lease by the configured length and says no cancel was asked', async () => {
  const path = join(dir, 'tasks.db');
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const tasks = await startedService(path);
  await createOpen(tasks);
  const executionId = await claimed(tasks);
  now.mockReturnValue(1_700_000_010_000);

  expect(await tasks.renew(executionId)).toEqual({
    ok: true,
    cancel: false,
    leaseMs,
  });
  await tasks.stop();
  expect(
    await readRow(
      path,
      'SELECT expires_at FROM task_executions WHERE id = ?',
      executionId,
    ),
  ).toEqual({ expires_at: 1_700_000_010_000 + leaseMs });
});

test('renew tells the runner that someone asked to cancel its task', async () => {
  const tasks = await startedService();
  const task = await createOpen(tasks);
  const executionId = await claimed(tasks);
  await tasks.cancel({ taskId: task.id, actor: planner });

  expect(await tasks.renew(executionId)).toEqual({
    ok: true,
    cancel: true,
    leaseMs,
  });
});

test('claim sent again with its claim id gets the same attempt back', async () => {
  const tasks = await startedService();
  await createOpen(tasks);
  await createOpen(tasks);
  const first = await tasks.claim({
    claimId: 'claim-1',
    runner,
    assignees: [dev],
  });

  expect(
    await tasks.claim({ claimId: 'claim-1', runner, assignees: [dev] }),
  ).toEqual(first);
});

test('finish sent again, the same finish, succeeds', async () => {
  const tasks = await startedService();
  await createOpen(tasks);
  const executionId = await claimed(tasks);
  const finish = { executionId, runner, outcome: Outcome.succeeded };
  await tasks.finish(finish);

  expect(await tasks.finish(finish)).toEqual({ ok: true });
});

test('a call past timeoutMs writes nothing and is refused as timeout', async () => {
  const tasks = await startedService(':memory:', { timeoutMs: 50 });
  // Each read of the clock is 60 ms after the last.
  let clock = 1_700_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => (clock += 60));

  expect(await tasks.create(newTask())).toEqual({
    ok: false,
    refusal: Refusal.timeout,
  });
  vi.restoreAllMocks();
  expect(
    await tasks.claim({ claimId: newClaim(), runner, assignees: [dev] }),
  ).toEqual({ ok: true, task: null });
});

test('renew refuses an attempt that ended as lease_lost', async () => {
  const tasks = await startedService();
  await createOpen(tasks);
  const executionId = await claimed(tasks);
  await tasks.finish({ executionId, runner, outcome: Outcome.succeeded });

  expect(await tasks.renew(executionId)).toEqual({
    ok: false,
    refusal: Refusal.leaseLost,
  });
});

test('renew refuses an attempt that is not a string as invalid', async () => {
  const tasks = await startedService();

  expect(await tasks.renew(7 as never)).toEqual({
    ok: false,
    refusal: Refusal.invalid,
  });
});

test.each(Object.values(Outcome))(
  'finish ends a running task as %s',
  async (outcome) => {
    const path = join(dir, 'tasks.db');
    const tasks = await startedService(path);
    const task = await createOpen(tasks);
    const executionId = await claimed(tasks);

    const result = await tasks.finish({ executionId, runner, outcome });
    await tasks.stop();

    expect(result).toEqual({ ok: true });
    expect(
      await readRow(path, 'SELECT status FROM tasks WHERE id = ?', task.id),
    ).toEqual({ status: outcome });
  },
);

test('finish records the runner as who finished the task, with the reason given', async () => {
  const path = join(dir, 'tasks.db');
  const tasks = await startedService(path);
  const task = await createOpen(tasks);
  const executionId = await claimed(tasks);

  await tasks.finish({
    executionId,
    runner: alice,
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

test('finish refuses an unknown attempt as lease_lost', async () => {
  const tasks = await startedService();

  expect(
    await tasks.finish({
      executionId: 'exe_missing',
      runner,
      outcome: Outcome.succeeded,
    }),
  ).toEqual({ ok: false, refusal: Refusal.leaseLost });
});

test('finish refuses a blank runner as invalid', async () => {
  const tasks = await startedService();
  await createOpen(tasks);
  const executionId = await claimed(tasks);

  expect(
    await tasks.finish({
      executionId,
      runner: { name: ' ' },
      outcome: Outcome.succeeded,
    }),
  ).toEqual({ ok: false, refusal: Refusal.invalid });
});

test('cancel cancels an open task at once, recording who and why', async () => {
  const path = join(dir, 'tasks.db');
  const tasks = await startedService(path);
  const task = await createOpen(tasks);

  expect(
    await tasks.cancel({ taskId: task.id, actor: planner, reason: 'dup' }),
  ).toEqual({ ok: true, status: Status.cancelled });
  await tasks.stop();
  expect(
    await readRow(
      path,
      "SELECT changed_by, reason FROM task_status_changes WHERE task_id = ? AND to_status = 'cancelled'",
      task.id,
    ),
  ).toEqual({ changed_by: 'planner', reason: 'dup' });
});

test('cancel leaves a running task running, for its runner to end', async () => {
  const tasks = await startedService();
  const task = await createOpen(tasks);
  await claimed(tasks);

  expect(await tasks.cancel({ taskId: task.id, actor: planner })).toEqual({
    ok: true,
    status: Status.running,
  });
});

test('cancel sent again, the same cancel, succeeds', async () => {
  const tasks = await startedService();
  const task = await createOpen(tasks);
  await tasks.cancel({ taskId: task.id, actor: planner, reason: 'dropped' });

  expect(
    await tasks.cancel({ taskId: task.id, actor: planner, reason: 'dropped' }),
  ).toEqual({ ok: true, status: Status.cancelled });
});

test('cancel refuses a finished task as already_finished and an unknown one as not_found', async () => {
  const tasks = await startedService();
  const task = await createOpen(tasks);
  await tasks.cancel({ taskId: task.id, actor: planner });

  expect(await tasks.cancel({ taskId: task.id, actor: alice })).toEqual({
    ok: false,
    refusal: Refusal.alreadyFinished,
  });
  expect(await tasks.cancel({ taskId: unknownId, actor: planner })).toEqual({
    ok: false,
    refusal: Refusal.notFound,
  });
});

test('assign hands an open task to another assignee', async () => {
  const tasks = await startedService();
  const task = await createOpen(tasks, { assignee: dev });

  expect(
    await tasks.assign({ taskId: task.id, assignee: alice, actor: planner }),
  ).toEqual({ ok: true });
  expect(
    await tasks.claim({ claimId: newClaim(), runner, assignees: [dev] }),
  ).toEqual({
    ok: true,
    task: null,
  });
  expect(
    await tasks.claim({ claimId: newClaim(), runner, assignees: [alice] }),
  ).toMatchObject({
    task: { id: task.id, assignee: alice },
  });
});

test('assign refuses a running task as not_open and an unknown one as not_found', async () => {
  const tasks = await startedService();
  const task = await createOpen(tasks);
  await claimed(tasks);

  expect(
    await tasks.assign({ taskId: task.id, assignee: alice, actor: planner }),
  ).toEqual({ ok: false, refusal: Refusal.notOpen });
  expect(
    await tasks.assign({ taskId: unknownId, assignee: alice, actor: planner }),
  ).toEqual({ ok: false, refusal: Refusal.notFound });
});

test('expire fails a task whose lease ran out, with one attempt, as the actor given', async () => {
  const path = join(dir, 'tasks.db');
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const tasks = await startedService(path);
  const task = await createOpen(tasks);
  const executionId = await claimed(tasks);
  now.mockReturnValue(1_700_000_000_000 + leaseMs);

  expect(await tasks.expire(server)).toEqual({
    ok: true,
    expired: [
      { taskId: task.id, executionId, attempt: 1, status: Status.failed },
    ],
  });
  expect(await tasks.renew(executionId)).toEqual({
    ok: false,
    refusal: Refusal.leaseLost,
  });
  await tasks.stop();
  expect(
    await readRow(
      path,
      "SELECT changed_by, reason FROM task_status_changes WHERE task_id = ? AND to_status = 'failed'",
      task.id,
    ),
  ).toEqual({ changed_by: 'server', reason: 'lease expired' });
});

test('expire opens a task again while the configured attempts allow', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const tasks = await startedService(':memory:', { maxAttempts: 2 });
  const task = await createOpen(tasks);
  const executionId = await claimed(tasks);
  now.mockReturnValue(1_700_000_000_000 + leaseMs);

  expect(await tasks.expire(server)).toEqual({
    ok: true,
    expired: [
      { taskId: task.id, executionId, attempt: 1, status: Status.open },
    ],
  });
  expect(
    await tasks.claim({ claimId: newClaim(), runner, assignees: [dev] }),
  ).toMatchObject({
    task: { id: task.id },
    execution: { attempt: 2 },
  });
});

test('expire refuses a blank actor as invalid', async () => {
  const tasks = await startedService();

  expect(await tasks.expire({ name: '' })).toEqual({
    ok: false,
    refusal: Refusal.invalid,
  });
});
