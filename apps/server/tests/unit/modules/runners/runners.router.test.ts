import { TRPCError } from '@trpc/server';
import { expect, test, vi } from 'vitest';
import { runnersRouter } from '../../../../src/modules/runners/runners.router';
import { Outcome, Refusal, Status, type Tasks } from '../../../../src/tasks';
import { createLogger } from '@sextou/logger';
import { memory } from '@sextou/logger/testing';
import { createCallerFactory } from '../../../../src/trpc';
import { aTask, fakeTasks, testContext } from '../../../tasks';

const createCaller = createCallerFactory(runnersRouter);

function caller(tasks: Partial<Tasks>) {
  return createCaller(testContext({ tasks: fakeTasks(tasks) }));
}

const task = aTask({ status: Status.running });

const execution = { id: 'exe_1', attempt: 1, leaseMs: 30000 };

const uses = {
  repo: 'thatsnotmynameio/sextou',
  sha: '87dfc7f4f839d6e334ab1a1cdf6494c62499d9ff',
  taskfile: 'packages/workflows/sextou/development/Taskfile.yml',
};

test("runners.claim hands the runner the task id, the task's uses, a null context and the attempt it holds", async () => {
  const claim = vi.fn(async () => ({
    ok: true as const,
    task,
    uses,
    execution,
  }));

  expect(
    await caller({ claim }).claim({
      claimId: 'claim-1',
      runner: ' runner-1 ',
      assignees: ['dev', ' qa '],
    }),
  ).toEqual({
    task: { id: task.id, uses, context: null },
    execution,
  });
  expect(claim).toHaveBeenCalledWith({
    claimId: 'claim-1',
    runner: { name: 'runner-1' },
    assignees: [{ name: 'dev' }, { name: 'qa' }],
  });
});

test("runners.claim hands the runner the task's context", async () => {
  const context = { repo: 'org/app', ref: 'main', depth: { n: [1, null] } };

  expect(
    await caller({
      claim: async () => ({
        ok: true,
        task: aTask({ status: Status.running, context }),
        uses,
        execution,
      }),
    }).claim({ claimId: 'claim-1', runner: 'runner-1', assignees: ['dev'] }),
  ).toMatchObject({ task: { context } });
});

test('runners.claim answers a null uses for a task that names none, with the attempt it holds', async () => {
  expect(
    await caller({
      claim: async () => ({ ok: true, task, uses: null, execution }),
    }).claim({ claimId: 'claim-1', runner: 'runner-1', assignees: ['dev'] }),
  ).toEqual({ task: { id: task.id, uses: null, context: null }, execution });
});

test('runners.claim answers a null task when none is ready', async () => {
  expect(
    await caller({
      claim: async () => ({ ok: true, task: null }),
    }).claim({ claimId: 'claim-1', runner: 'runner-1', assignees: ['dev'] }),
  ).toEqual({ task: null });
});

test.each([
  { claimId: 'claim-1', runner: ' ', assignees: ['dev'] },
  { claimId: 'claim-1', runner: 'runner-1', assignees: [] },
  { claimId: 'claim-1', runner: 'runner-1', assignees: [''] },
  { claimId: '', runner: 'runner-1', assignees: ['dev'] },
  { runner: 'runner-1', assignees: ['dev'] },
])('runners.claim refuses %j as BAD_REQUEST', async (input) => {
  await expect(caller({}).claim(input as never)).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
});

test('runners.claim turns a refusal into BAD_REQUEST, named in the message', async () => {
  await expect(
    caller({
      claim: async () => ({ ok: false, refusal: Refusal.invalid }),
    }).claim({ claimId: 'claim-1', runner: 'runner-1', assignees: ['dev'] }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'invalid' });
});

test('runners.claim fails with INTERNAL_SERVER_ERROR when its answer breaks the output schema', async () => {
  const result = caller({
    claim: async () => ({
      ok: true,
      task,
      uses,
      execution: { ...execution, attempt: 0 },
    }),
  }).claim({ claimId: 'claim-1', runner: 'runner-1', assignees: ['dev'] });

  await expect(result).rejects.toBeInstanceOf(TRPCError);
  await expect(result).rejects.toMatchObject({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Output validation failed',
  });
});

test.each([true, false])(
  'runners.heartbeat answers cancel: %s and the lease as the tasks say',
  async (cancel) => {
    const renew = vi.fn(async () => ({
      ok: true as const,
      cancel,
      leaseMs: 6000,
    }));

    expect(await caller({ renew }).heartbeat({ executionId: 'exe_1' })).toEqual(
      { cancel, leaseMs: 6000 },
    );
    expect(renew).toHaveBeenCalledWith('exe_1');
  },
);

test('runners.heartbeat fails with TIMEOUT, timeout, when the tasks database took too long', async () => {
  await expect(
    caller({
      renew: async () => ({ ok: false, refusal: Refusal.timeout }),
    }).heartbeat({ executionId: 'exe_1' }),
  ).rejects.toMatchObject({ code: 'TIMEOUT', message: 'timeout' });
});

test('runners.heartbeat fails with CONFLICT, lease_lost, for an attempt that lost its lease', async () => {
  await expect(
    caller({
      renew: async () => ({ ok: false, refusal: Refusal.leaseLost }),
    }).heartbeat({ executionId: 'exe_1' }),
  ).rejects.toMatchObject({ code: 'CONFLICT', message: 'lease_lost' });
});

test('runners.heartbeat refuses an empty attempt as BAD_REQUEST', async () => {
  await expect(caller({}).heartbeat({ executionId: '' })).rejects.toMatchObject(
    { code: 'BAD_REQUEST' },
  );
});

test.each(Object.values(Outcome))(
  'runners.complete ends the task as %s for the runner, with no created tasks',
  async (outcome) => {
    const finish = vi.fn(async () => ({
      ok: true as const,
      outcome,
      reason: 'done',
      created: [],
    }));

    expect(
      await caller({ finish }).complete({
        runner: 'runner-1',
        executionId: 'exe_1',
        outcome,
        reason: 'done',
      }),
    ).toEqual({ outcome, reason: 'done', created: [] });
    expect(finish).toHaveBeenCalledWith({
      executionId: 'exe_1',
      runner: { name: 'runner-1' },
      outcome,
      reason: 'done',
    });
  },
);

const created = [
  { key: 'review', id: 'tsk_2' },
  { key: 'merge', id: 'tsk_3' },
];

// Completes an attempt that succeeded with a tasks file, against tasks that
// created two tasks from it.
async function completeWithTasks() {
  const finish = vi.fn(async () => ({
    ok: true as const,
    outcome: Outcome.succeeded,
    reason: null,
    created,
  }));
  const answer = await caller({ finish }).complete({
    runner: 'runner-1',
    executionId: 'exe_1',
    outcome: Outcome.succeeded,
    tasks: '{"tasks":[]}',
  });
  return { finish, answer };
}

test("runners.complete passes the run's tasks file to the tasks", async () => {
  const { finish } = await completeWithTasks();

  expect(finish).toHaveBeenCalledWith({
    executionId: 'exe_1',
    runner: { name: 'runner-1' },
    outcome: Outcome.succeeded,
    tasks: '{"tasks":[]}',
  });
});

test('runners.complete answers the tasks it created from the tasks file', async () => {
  const { answer } = await completeWithTasks();

  expect(answer).toEqual({ outcome: Outcome.succeeded, reason: null, created });
});

test('runners.complete answers the outcome the tasks recorded, failed with its reason, for a file they refused', async () => {
  const reason = 'the tasks file holds 51 tasks, more than 50';

  expect(
    await caller({
      finish: async () => ({
        ok: true,
        outcome: Outcome.failed,
        reason,
        created: [],
      }),
    }).complete({
      runner: 'runner-1',
      executionId: 'exe_1',
      outcome: Outcome.succeeded,
      tasks: '{"tasks":[]}',
    }),
  ).toEqual({ outcome: Outcome.failed, reason, created: [] });
});

// The records a completion that created two tasks logs.
async function createdRecords() {
  const output = memory();
  const logger = createLogger(
    { level: 'info', pretty: false },
    output.destination,
  );

  await createCaller(
    testContext({
      logger,
      tasks: fakeTasks({
        finish: async () => ({
          ok: true,
          outcome: Outcome.succeeded,
          reason: null,
          created,
        }),
      }),
    }),
  ).complete({
    runner: 'runner-1',
    executionId: 'exe_1',
    outcome: Outcome.succeeded,
    tasks: '{"tasks":[]}',
  });
  return output.records();
}

test('runners.complete logs one record per created task', async () => {
  expect(await createdRecords()).toEqual([
    expect.objectContaining({ level: 30, msg: 'task created' }),
    expect.objectContaining({ level: 30, msg: 'task created' }),
  ]);
});

test('runners.complete logs each created task with its key, its id, the attempt that created it', async () => {
  expect(await createdRecords()).toEqual([
    expect.objectContaining({
      key: 'review',
      taskId: 'tsk_2',
      executionId: 'exe_1',
    }),
    expect.objectContaining({
      key: 'merge',
      taskId: 'tsk_3',
      executionId: 'exe_1',
    }),
  ]);
});

test('runners.complete logs nothing when it created no task', async () => {
  const output = memory();
  const logger = createLogger(
    { level: 'info', pretty: false },
    output.destination,
  );

  await createCaller(
    testContext({
      logger,
      tasks: fakeTasks({
        finish: async () => ({
          ok: true,
          outcome: Outcome.succeeded,
          reason: null,
          created: [],
        }),
      }),
    }),
  ).complete({
    runner: 'runner-1',
    executionId: 'exe_1',
    outcome: Outcome.succeeded,
  });

  expect(output.records()).toEqual([]);
});

test('runners.complete fails with INTERNAL_SERVER_ERROR when its answer breaks the output schema', async () => {
  await expect(
    caller({
      finish: async () => ({
        ok: true,
        outcome: Outcome.succeeded,
        reason: null,
        created: [{ key: 'review', id: '' }],
      }),
    }).complete({
      runner: 'runner-1',
      executionId: 'exe_1',
      outcome: Outcome.succeeded,
    }),
  ).rejects.toMatchObject({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Output validation failed',
  });
});

test('runners.complete fails with CONFLICT, lease_lost, for an attempt that lost its lease', async () => {
  await expect(
    caller({
      finish: async () => ({ ok: false, refusal: Refusal.leaseLost }),
    }).complete({
      runner: 'runner-1',
      executionId: 'exe_1',
      outcome: Outcome.succeeded,
    }),
  ).rejects.toMatchObject({ code: 'CONFLICT', message: 'lease_lost' });
});

test.each([Status.open, Status.running, 'closed'])(
  'runners.complete refuses %j as the outcome as BAD_REQUEST',
  async (outcome) => {
    await expect(
      caller({}).complete({
        runner: 'runner-1',
        executionId: 'exe_1',
        outcome: outcome as never,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  },
);
