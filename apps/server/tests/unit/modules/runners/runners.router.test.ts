import { TRPCError } from '@trpc/server';
import { expect, test, vi } from 'vitest';
import { runnersRouter } from '../../../../src/modules/runners/runners.router';
import { Outcome, Refusal, Status, type Tasks } from '../../../../src/tasks';
import { createCallerFactory } from '../../../../src/trpc';
import { aTask, fakeTasks, testContext } from '../../../tasks';

const createCaller = createCallerFactory(runnersRouter);

function caller(tasks: Partial<Tasks>) {
  return createCaller(testContext({ tasks: fakeTasks(tasks) }));
}

const task = aTask({ status: Status.running });

const execution = { id: 'exe_1', attempt: 1, leaseMs: 30000 };

test('runners.claim hands the runner the task and the attempt it holds', async () => {
  const claim = vi.fn(async () => ({ ok: true as const, task, execution }));

  expect(
    await caller({ claim }).claim({
      runner: ' runner-1 ',
      assignees: ['dev', ' qa '],
    }),
  ).toEqual({ task, execution });
  expect(claim).toHaveBeenCalledWith({
    runner: { name: 'runner-1' },
    assignees: [{ name: 'dev' }, { name: 'qa' }],
  });
});

test('runners.claim answers a null task when none is ready', async () => {
  expect(
    await caller({
      claim: async () => ({ ok: true, task: null }),
    }).claim({ runner: 'runner-1', assignees: ['dev'] }),
  ).toEqual({ task: null });
});

test.each([
  { runner: ' ', assignees: ['dev'] },
  { runner: 'runner-1', assignees: [] },
  { runner: 'runner-1', assignees: [''] },
])('runners.claim refuses %j as BAD_REQUEST', async (input) => {
  await expect(caller({}).claim(input)).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
});

test('runners.claim turns a refusal into BAD_REQUEST, named in the message', async () => {
  await expect(
    caller({
      claim: async () => ({ ok: false, refusal: Refusal.invalid }),
    }).claim({ runner: 'runner-1', assignees: ['dev'] }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'invalid' });
});

test('runners.claim fails with INTERNAL_SERVER_ERROR when its answer breaks the output schema', async () => {
  const result = caller({
    claim: async () => ({
      ok: true,
      task,
      execution: { ...execution, attempt: 0 },
    }),
  }).claim({ runner: 'runner-1', assignees: ['dev'] });

  await expect(result).rejects.toBeInstanceOf(TRPCError);
  await expect(result).rejects.toMatchObject({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Output validation failed',
  });
});

test.each([true, false])(
  'runners.heartbeat answers cancel: %s as the tasks say',
  async (cancel) => {
    const renew = vi.fn(async () => ({ ok: true as const, cancel }));

    expect(await caller({ renew }).heartbeat({ executionId: 'exe_1' })).toEqual(
      { cancel },
    );
    expect(renew).toHaveBeenCalledWith('exe_1');
  },
);

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
  'runners.complete ends the task as %s for the runner',
  async (outcome) => {
    const finish = vi.fn(async () => ({ ok: true as const }));

    expect(
      await caller({ finish }).complete({
        runner: 'runner-1',
        executionId: 'exe_1',
        outcome,
        reason: 'done',
      }),
    ).toBeNull();
    expect(finish).toHaveBeenCalledWith({
      executionId: 'exe_1',
      runner: { name: 'runner-1' },
      outcome,
      reason: 'done',
    });
  },
);

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
