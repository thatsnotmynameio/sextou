import { afterEach, beforeEach, expect, test, vi, type Mock } from 'vitest';
import type { Answer, RunnerClient } from '../../src/client';
import { createLogger } from '../../src/logger';
import {
  startRunner,
  type Claimed,
  type Execute,
  type Result,
} from '../../src/runner';
import { sleep } from '../../src/sleep';
import { memory } from '../logger';

const pollMs = 1000;
const holdMs = 10000;

let output: ReturnType<typeof memory>;
let client: { [K in keyof RunnerClient]: Mock<RunnerClient[K]> };
let runner: ReturnType<typeof startRunner> | undefined;

function ok<T>(value: T): Answer<T> {
  return { ok: true, value };
}

const noAnswer = {
  ok: false,
  failure: 'no_answer',
  message: 'fetch failed',
} as const;
const leaseLost = {
  ok: false,
  failure: 'lease_lost',
  message: 'lease_lost',
} as const;

// A claim that hands the runner task tsk_1 under a lease of `leaseMs`.
function task(leaseMs = 3000): Answer<Claimed> {
  return ok({
    task: { id: 'tsk_1', taskfile: 'version: 3' },
    execution: { id: 'exe_1', attempt: 1, leaseMs },
  });
}

// A run that takes `ms` and succeeds, or fails once its signal aborts.
function hold(ms: number): Execute {
  return async (_task, { signal }) => {
    await sleep(ms, signal);
    return signal.aborted
      ? { outcome: 'failed', reason: 'aborted' }
      : { outcome: 'succeeded' };
  };
}

// Unless a test passes its own, each run takes holdMs.
function start(execute: Execute = hold(holdMs)) {
  let ids = 0;
  runner = startRunner({
    client,
    name: 'r1',
    assignees: ['dev'],
    pollMs,
    execute,
    logger: createLogger({ level: 'debug', pretty: false }, output.destination),
    newId: () => `c${++ids}`,
  });
  return runner;
}

function messages() {
  return output.records().map((record) => (record as { msg: string }).msg);
}

beforeEach(() => {
  vi.useFakeTimers();
  output = memory();
  // With nothing scripted, the server has no task and accepts every call.
  client = {
    claim: vi.fn<RunnerClient['claim']>(() =>
      Promise.resolve(ok({ task: null })),
    ),
    heartbeat: vi.fn<RunnerClient['heartbeat']>(() =>
      Promise.resolve(ok({ cancel: false, leaseMs: 3000 })),
    ),
    complete: vi.fn<RunnerClient['complete']>(() => Promise.resolve(ok(null))),
  };
});

afterEach(async () => {
  await runner?.stop();
  runner = undefined;
  vi.useRealTimers();
});

test('startRunner claims for its name and assignees at once', async () => {
  start();
  await vi.advanceTimersByTimeAsync(0);

  expect(client.claim.mock.calls).toEqual([
    [{ claimId: 'c1', runner: 'r1', assignees: ['dev'] }],
  ]);
});

test('startRunner with no task claims again with a new claimId after pollMs', async () => {
  start();
  await vi.advanceTimersByTimeAsync(pollMs - 1);
  expect(client.claim).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(1);

  expect(client.claim.mock.calls.map(([input]) => input.claimId)).toEqual([
    'c1',
    'c2',
  ]);
});

test.each([
  noAnswer,
  { ok: false, failure: 'refused', message: 'timeout' } as const,
])(
  'startRunner sends a claim answered $failure again with the same claimId after pollMs',
  async (failure) => {
    client.claim.mockResolvedValueOnce(failure);
    start();
    await vi.advanceTimersByTimeAsync(pollMs - 1);
    expect(client.claim).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);

    expect(client.claim.mock.calls.map(([input]) => input.claimId)).toEqual([
      'c1',
      'c1',
    ]);
    expect(output.records()[0]).toMatchObject({
      level: 40,
      msg: 'claim failed',
      claimId: 'c1',
      failure: failure.failure,
      message: failure.message,
    });
  },
);

test('startRunner logs the task it claimed', async () => {
  client.claim.mockResolvedValueOnce(task());
  start();
  await vi.advanceTimersByTimeAsync(0);

  expect(output.records()).toEqual([
    expect.objectContaining({
      level: 30,
      msg: 'claimed',
      taskId: 'tsk_1',
      executionId: 'exe_1',
      attempt: 1,
    }),
  ]);
});

test('startRunner sends a heartbeat every third of the lease while it holds a task', async () => {
  client.claim.mockResolvedValueOnce(task(3000));
  start();
  await vi.advanceTimersByTimeAsync(999);
  expect(client.heartbeat).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(1);
  expect(client.heartbeat.mock.calls).toEqual([['exe_1']]);

  await vi.advanceTimersByTimeAsync(1000);
  expect(client.heartbeat).toHaveBeenCalledTimes(2);
  expect(output.records()[1]).toMatchObject({
    level: 20,
    msg: 'heartbeat',
    taskId: 'tsk_1',
    executionId: 'exe_1',
    attempt: 1,
    cancel: false,
  });
});

test('startRunner paces the next heartbeat by the lease the last one answered', async () => {
  client.claim.mockResolvedValueOnce(task(3000));
  client.heartbeat.mockResolvedValueOnce(ok({ cancel: false, leaseMs: 6000 }));
  start();
  await vi.advanceTimersByTimeAsync(1000);
  expect(client.heartbeat).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(1999);
  expect(client.heartbeat).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(1);
  expect(client.heartbeat).toHaveBeenCalledTimes(2);
});

test('startRunner paces the first heartbeat from when the claim was sent', async () => {
  client.claim.mockImplementationOnce(
    () => new Promise((resolve) => setTimeout(() => resolve(task(3000)), 400)),
  );
  start();
  await vi.advanceTimersByTimeAsync(999);
  expect(client.heartbeat).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(1);

  expect(client.heartbeat).toHaveBeenCalledTimes(1);
});

test('startRunner paces the next heartbeat from when the last one was sent, not answered', async () => {
  client.claim.mockResolvedValueOnce(task(3000));
  client.heartbeat.mockImplementationOnce(
    () =>
      new Promise((resolve) =>
        setTimeout(() => resolve(ok({ cancel: false, leaseMs: 3000 })), 400),
      ),
  );
  start();
  await vi.advanceTimersByTimeAsync(1999);
  expect(client.heartbeat).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(1);

  expect(client.heartbeat).toHaveBeenCalledTimes(2);
});

test('startRunner sends a heartbeat again at once when the last one failed after a third of the lease', async () => {
  client.claim.mockResolvedValueOnce(task(3000));
  client.heartbeat.mockImplementationOnce(
    () => new Promise((resolve) => setTimeout(() => resolve(noAnswer), 1500)),
  );
  start();
  await vi.advanceTimersByTimeAsync(2499);
  expect(client.heartbeat).toHaveBeenCalledTimes(1);

  // The answer lands at 2500; the retry goes on the next timer tick.
  await vi.advanceTimersByTimeAsync(2);

  expect(client.heartbeat).toHaveBeenCalledTimes(2);
});

test('startRunner completes a task as succeeded once its run succeeded', async () => {
  client.claim.mockResolvedValueOnce(task(3000));
  start();
  await vi.advanceTimersByTimeAsync(holdMs - 1);
  expect(client.complete).not.toHaveBeenCalled();
  expect(client.heartbeat).toHaveBeenCalledTimes(9);

  await vi.advanceTimersByTimeAsync(1);

  expect(client.complete.mock.calls).toEqual([
    [{ runner: 'r1', executionId: 'exe_1', outcome: 'succeeded' }],
  ]);
  expect(client.heartbeat).toHaveBeenCalledTimes(9);
  expect(output.records().at(-1)).toMatchObject({
    level: 30,
    msg: 'completed',
    taskId: 'tsk_1',
    executionId: 'exe_1',
    attempt: 1,
    outcome: 'succeeded',
  });
});

test('startRunner completes a task held for less than a third of its lease with no heartbeat', async () => {
  client.claim.mockResolvedValueOnce(task(60000));
  start();
  await vi.advanceTimersByTimeAsync(holdMs);

  expect(client.heartbeat).not.toHaveBeenCalled();
  expect(client.complete.mock.calls).toEqual([
    [{ runner: 'r1', executionId: 'exe_1', outcome: 'succeeded' }],
  ]);
});

test('startRunner claims again with a new claimId once it completed a task', async () => {
  client.claim.mockResolvedValueOnce(task(60000));
  start();
  await vi.advanceTimersByTimeAsync(holdMs);

  expect(client.claim.mock.calls.map(([input]) => input.claimId)).toEqual([
    'c1',
    'c2',
  ]);
});

test('startRunner completes a task as cancelled when a heartbeat says to cancel it', async () => {
  client.claim.mockResolvedValueOnce(task(3000));
  client.heartbeat.mockResolvedValueOnce(ok({ cancel: true, leaseMs: 3000 }));
  start();
  await vi.advanceTimersByTimeAsync(1000);

  expect(client.complete.mock.calls).toEqual([
    [{ runner: 'r1', executionId: 'exe_1', outcome: 'cancelled' }],
  ]);
  expect(client.heartbeat).toHaveBeenCalledTimes(1);
  expect(output.records().at(-1)).toMatchObject({
    msg: 'completed',
    outcome: 'cancelled',
  });
});

test('startRunner drops a task whose heartbeat lost the lease and claims again', async () => {
  client.claim.mockResolvedValueOnce(task(3000));
  client.heartbeat.mockResolvedValueOnce(leaseLost);
  start();
  await vi.advanceTimersByTimeAsync(holdMs);

  expect(client.heartbeat).toHaveBeenCalledTimes(1);
  expect(client.complete).not.toHaveBeenCalled();
  expect(client.claim.mock.calls[1][0].claimId).toBe('c2');
  expect(output.records()[1]).toMatchObject({
    level: 40,
    msg: 'lease lost',
    taskId: 'tsk_1',
    executionId: 'exe_1',
  });
});

test('startRunner keeps a task whose heartbeat got no answer and sends the next one', async () => {
  client.claim.mockResolvedValueOnce(task(3000));
  client.heartbeat.mockResolvedValueOnce(noAnswer);
  start();
  await vi.advanceTimersByTimeAsync(1000);
  expect(output.records()[1]).toMatchObject({
    level: 40,
    msg: 'heartbeat failed',
    executionId: 'exe_1',
    failure: 'no_answer',
    message: 'fetch failed',
  });

  await vi.advanceTimersByTimeAsync(1000);
  expect(client.heartbeat).toHaveBeenCalledTimes(2);

  await vi.advanceTimersByTimeAsync(holdMs - 2000);
  expect(client.complete).toHaveBeenCalledTimes(1);
});

test('startRunner sends a completion that got no answer again, as it was, after pollMs', async () => {
  client.claim.mockResolvedValueOnce(task(60000));
  client.complete.mockResolvedValueOnce(noAnswer);
  start();
  await vi.advanceTimersByTimeAsync(holdMs);
  expect(client.complete).toHaveBeenCalledTimes(1);
  expect(output.records()[1]).toMatchObject({
    level: 40,
    msg: 'complete failed',
    outcome: 'succeeded',
    failure: 'no_answer',
  });

  await vi.advanceTimersByTimeAsync(pollMs - 1);
  expect(client.complete).toHaveBeenCalledTimes(1);
  expect(client.claim).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(1);
  expect(client.complete.mock.calls).toEqual([
    [{ runner: 'r1', executionId: 'exe_1', outcome: 'succeeded' }],
    [{ runner: 'r1', executionId: 'exe_1', outcome: 'succeeded' }],
  ]);
  expect(messages()).toEqual(['claimed', 'complete failed', 'completed']);
});

test('startRunner sends a completion the server did not serve in time again after pollMs', async () => {
  client.claim.mockResolvedValueOnce(task(60000));
  client.complete.mockResolvedValueOnce({
    ok: false,
    failure: 'timeout',
    message: 'timeout',
  });
  start();
  await vi.advanceTimersByTimeAsync(holdMs + pollMs);

  expect(client.complete).toHaveBeenCalledTimes(2);
  expect(messages()).toEqual(['claimed', 'complete failed', 'completed']);
});

test('startRunner drops a task whose completion the server refused and claims again', async () => {
  client.claim.mockResolvedValueOnce(task(60000));
  client.complete.mockResolvedValueOnce({
    ok: false,
    failure: 'refused',
    message: 'not_found',
  });
  start();
  await vi.advanceTimersByTimeAsync(holdMs + pollMs * 3);

  expect(client.complete).toHaveBeenCalledTimes(1);
  expect(client.claim.mock.calls[1][0].claimId).toBe('c2');
  expect(output.records()[1]).toMatchObject({
    level: 40,
    msg: 'complete refused',
    taskId: 'tsk_1',
    executionId: 'exe_1',
    outcome: 'succeeded',
    message: 'not_found',
  });
});

test('startRunner drops a task whose completion lost the lease and claims again', async () => {
  client.claim.mockResolvedValueOnce(task(60000));
  client.complete.mockResolvedValueOnce(leaseLost);
  start();
  await vi.advanceTimersByTimeAsync(holdMs);

  expect(client.complete).toHaveBeenCalledTimes(1);
  expect(client.claim).toHaveBeenCalledTimes(2);
  expect(messages()).toEqual(['claimed', 'lease lost']);
});

test('stop while the runner waits to claim resolves with no new call', async () => {
  start();
  await vi.advanceTimersByTimeAsync(0);

  await runner?.stop();
  await vi.advanceTimersByTimeAsync(pollMs * 10);

  expect(client.claim).toHaveBeenCalledTimes(1);
});

test('stop leaves no timer behind', async () => {
  client.claim.mockResolvedValueOnce(task(3000));
  start();
  await vi.advanceTimersByTimeAsync(500);

  await runner?.stop();

  expect(vi.getTimerCount()).toBe(0);
});

test('stop while the runner holds a task sends no heartbeat and no completion', async () => {
  client.claim.mockResolvedValueOnce(task(3000));
  start();
  await vi.advanceTimersByTimeAsync(500);

  await runner?.stop();
  await vi.advanceTimersByTimeAsync(holdMs * 2);

  expect(client.heartbeat).not.toHaveBeenCalled();
  expect(client.complete).not.toHaveBeenCalled();
  expect(client.claim).toHaveBeenCalledTimes(1);
});

test('stop after the last heartbeat sends no completion', async () => {
  client.claim.mockResolvedValueOnce(task(3000));
  start();
  await vi.advanceTimersByTimeAsync(holdMs - 500);

  await runner?.stop();
  await vi.advanceTimersByTimeAsync(holdMs);

  expect(client.complete).not.toHaveBeenCalled();
});

test('stop while a completion waits to be sent again sends it no more', async () => {
  client.claim.mockResolvedValueOnce(task(60000));
  client.complete.mockResolvedValueOnce(noAnswer);
  start();
  await vi.advanceTimersByTimeAsync(holdMs);

  await runner?.stop();
  await vi.advanceTimersByTimeAsync(pollMs * 10);

  expect(client.complete).toHaveBeenCalledTimes(1);
  expect(client.claim).toHaveBeenCalledTimes(1);
});

test('stop while a call is in flight resolves once it is answered, with no new call', async () => {
  let answer: (claimed: Answer<Claimed>) => void = () => {};
  client.claim.mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  start();
  await vi.advanceTimersByTimeAsync(0);
  let stopped = false;
  const stopping = runner?.stop().then(() => {
    stopped = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(stopped).toBe(false);

  answer(ok({ task: null }));
  await stopping;

  expect(stopped).toBe(true);
  expect(client.claim).toHaveBeenCalledTimes(1);
});

test('stop while a heartbeat is in flight sends no completion once it is answered', async () => {
  let answer: (
    beat: Awaited<ReturnType<RunnerClient['heartbeat']>>,
  ) => void = () => {};
  client.claim.mockResolvedValueOnce(task(3000));
  client.heartbeat.mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  start();
  await vi.advanceTimersByTimeAsync(1000);
  const stopping = runner?.stop();

  answer(ok({ cancel: false, leaseMs: 3000 }));
  await stopping;
  await vi.advanceTimersByTimeAsync(holdMs * 2);

  expect(client.heartbeat).toHaveBeenCalledTimes(1);
  expect(client.complete).not.toHaveBeenCalled();
});

// An execute the test ends: `end` resolves the run it started, `signal` is
// the one it got.
function controlled() {
  const run: {
    end: (result: Result) => void;
    fail: (error: Error) => void;
    signal?: AbortSignal;
    calls: Parameters<Execute>[];
  } = { end: () => {}, fail: () => {}, calls: [] };
  const execute: Execute = (...args) => {
    run.calls.push(args);
    run.signal = args[1].signal;
    return new Promise((resolve, reject) => {
      run.end = resolve;
      run.fail = reject;
    });
  };
  return { run, execute };
}

test('startRunner executes the task it claimed with a logger bound to its ids', async () => {
  const { run, execute } = controlled();
  client.claim.mockResolvedValueOnce(task(60000));
  start(execute);
  await vi.advanceTimersByTimeAsync(0);

  run.calls[0][1].logger.info('ran');

  expect(run.calls[0][0].id).toBe('tsk_1');
  expect(run.signal?.aborted).toBe(false);
  expect(output.records().at(-1)).toMatchObject({
    msg: 'ran',
    taskId: 'tsk_1',
    executionId: 'exe_1',
    attempt: 1,
  });
  run.end({ outcome: 'succeeded' });
});

test('startRunner sends heartbeats for as long as the run lasts', async () => {
  const { run, execute } = controlled();
  client.claim.mockResolvedValueOnce(task(3000));
  start(execute);
  await vi.advanceTimersByTimeAsync(holdMs * 3);
  expect(client.heartbeat).toHaveBeenCalledTimes(30);
  expect(client.complete).not.toHaveBeenCalled();

  run.end({ outcome: 'succeeded' });
  await vi.advanceTimersByTimeAsync(holdMs);

  expect(client.heartbeat).toHaveBeenCalledTimes(30);
  expect(client.complete).toHaveBeenCalledTimes(1);
});

test('startRunner completes a task as failed with the reason the run gave', async () => {
  const { run, execute } = controlled();
  client.claim.mockResolvedValueOnce(task(60000));
  start(execute);
  await vi.advanceTimersByTimeAsync(0);

  run.end({ outcome: 'failed', reason: 'exit code 3' });
  await vi.advanceTimersByTimeAsync(0);

  expect(client.complete.mock.calls).toEqual([
    [
      {
        runner: 'r1',
        executionId: 'exe_1',
        outcome: 'failed',
        reason: 'exit code 3',
      },
    ],
  ]);
  expect(output.records().at(-1)).toMatchObject({
    level: 30,
    msg: 'completed',
    outcome: 'failed',
    reason: 'exit code 3',
  });
});

test('startRunner completes a task as failed with the message of a run that rejected', async () => {
  const { run, execute } = controlled();
  client.claim.mockResolvedValueOnce(task(60000));
  start(execute);
  await vi.advanceTimersByTimeAsync(0);

  run.fail(new Error('boom'));
  await vi.advanceTimersByTimeAsync(0);

  expect(client.complete.mock.calls).toEqual([
    [{ runner: 'r1', executionId: 'exe_1', outcome: 'failed', reason: 'boom' }],
  ]);
});

test('startRunner stops the run a heartbeat says to cancel and completes it as cancelled once it ended', async () => {
  const { run, execute } = controlled();
  client.claim.mockResolvedValueOnce(task(3000));
  client.heartbeat.mockResolvedValueOnce(ok({ cancel: true, leaseMs: 3000 }));
  start(execute);
  await vi.advanceTimersByTimeAsync(1000);
  expect(run.signal?.aborted).toBe(true);
  expect(client.complete).not.toHaveBeenCalled();

  run.end({ outcome: 'failed', reason: 'signal SIGTERM' });
  await vi.advanceTimersByTimeAsync(0);

  expect(client.complete.mock.calls).toEqual([
    [{ runner: 'r1', executionId: 'exe_1', outcome: 'cancelled' }],
  ]);
});

test('startRunner stops the run whose heartbeat lost the lease and completes nothing', async () => {
  const { run, execute } = controlled();
  client.claim.mockResolvedValueOnce(task(3000));
  client.heartbeat.mockResolvedValueOnce(leaseLost);
  start(execute);
  await vi.advanceTimersByTimeAsync(1000);
  expect(run.signal?.aborted).toBe(true);
  expect(client.claim).toHaveBeenCalledTimes(1);

  run.end({ outcome: 'failed', reason: 'signal SIGTERM' });
  await vi.advanceTimersByTimeAsync(0);

  expect(client.complete).not.toHaveBeenCalled();
  expect(client.claim).toHaveBeenCalledTimes(2);
});

test('stop stops the run and resolves once it ended, with no completion', async () => {
  const { run, execute } = controlled();
  client.claim.mockResolvedValueOnce(task(3000));
  start(execute);
  await vi.advanceTimersByTimeAsync(500);
  let stopped = false;
  const stopping = runner?.stop().then(() => {
    stopped = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(run.signal?.aborted).toBe(true);
  expect(stopped).toBe(false);

  run.end({ outcome: 'failed', reason: 'signal SIGTERM' });
  await stopping;

  expect(stopped).toBe(true);
  expect(client.heartbeat).not.toHaveBeenCalled();
  expect(client.complete).not.toHaveBeenCalled();
});

test('startRunner stops the run once its lease ran out with no heartbeat answered, and completes nothing', async () => {
  const { run, execute } = controlled();
  client.claim.mockResolvedValueOnce(task(3000));
  client.heartbeat.mockResolvedValue(noAnswer);
  start(execute);
  await vi.advanceTimersByTimeAsync(2999);
  expect(run.signal?.aborted).toBe(false);
  expect(client.heartbeat).toHaveBeenCalledTimes(2);

  await vi.advanceTimersByTimeAsync(1);
  expect(run.signal?.aborted).toBe(true);
  expect(client.heartbeat).toHaveBeenCalledTimes(2);
  expect(output.records().at(-1)).toMatchObject({
    level: 40,
    msg: 'lease expired',
    taskId: 'tsk_1',
    executionId: 'exe_1',
  });

  run.end({ outcome: 'failed', reason: 'signal SIGTERM' });
  await vi.advanceTimersByTimeAsync(0);

  expect(client.complete).not.toHaveBeenCalled();
  expect(client.claim).toHaveBeenCalledTimes(2);
});

test('startRunner counts the lease from the last heartbeat answered', async () => {
  const { run, execute } = controlled();
  client.claim.mockResolvedValueOnce(task(3000));
  client.heartbeat
    .mockResolvedValueOnce(ok({ cancel: false, leaseMs: 3000 }))
    .mockResolvedValue(noAnswer);
  start(execute);
  await vi.advanceTimersByTimeAsync(3999);
  expect(run.signal?.aborted).toBe(false);

  await vi.advanceTimersByTimeAsync(1);

  expect(run.signal?.aborted).toBe(true);
  run.end({ outcome: 'succeeded' });
});

test('startRunner stops the run when the heartbeat answer arrives after the lease ran out', async () => {
  const { run, execute } = controlled();
  client.claim.mockResolvedValueOnce(task(3000));
  client.heartbeat.mockImplementationOnce(
    () => new Promise((resolve) => setTimeout(() => resolve(noAnswer), 2500)),
  );
  start(execute);
  await vi.advanceTimersByTimeAsync(3499);
  expect(run.signal?.aborted).toBe(false);

  // The answer lands at 3500; the stop goes on the next timer tick.
  await vi.advanceTimersByTimeAsync(2);

  expect(run.signal?.aborted).toBe(true);
  expect(client.heartbeat).toHaveBeenCalledTimes(1);
  run.end({ outcome: 'succeeded' });
});

test('startRunner completes a task as failed when execute throws before it returns', async () => {
  client.claim.mockResolvedValueOnce(task(60000));
  start(() => {
    throw new Error('no taskfile');
  });
  await vi.advanceTimersByTimeAsync(0);

  expect(client.complete.mock.calls).toEqual([
    [
      {
        runner: 'r1',
        executionId: 'exe_1',
        outcome: 'failed',
        reason: 'no taskfile',
      },
    ],
  ]);
});

test.each([
  ['a string', 'boom', 'boom'],
  ['undefined', undefined, 'undefined'],
])(
  'startRunner completes a task as failed when execute rejects with %s',
  async (_name, error, reason) => {
    client.claim.mockResolvedValueOnce(task(60000));
    start(() => Promise.reject(error));
    await vi.advanceTimersByTimeAsync(0);

    expect(client.complete.mock.calls).toEqual([
      [{ runner: 'r1', executionId: 'exe_1', outcome: 'failed', reason }],
    ]);
  },
);

test('startRunner keeps renewing the lease while a cancelled run winds down', async () => {
  const { run, execute } = controlled();
  client.claim.mockResolvedValueOnce(task(3000));
  client.heartbeat.mockResolvedValue(ok({ cancel: true, leaseMs: 3000 }));
  start(execute);
  await vi.advanceTimersByTimeAsync(5000);
  expect(run.signal?.aborted).toBe(true);
  expect(client.heartbeat).toHaveBeenCalledTimes(5);
  expect(client.complete).not.toHaveBeenCalled();

  run.end({ outcome: 'failed', reason: 'signal SIGTERM' });
  await vi.advanceTimersByTimeAsync(1000);

  expect(client.heartbeat).toHaveBeenCalledTimes(5);
  expect(client.complete.mock.calls).toEqual([
    [{ runner: 'r1', executionId: 'exe_1', outcome: 'cancelled' }],
  ]);
});

test('startRunner completes a run that ended before a cancel arrived with how it ended', async () => {
  const { run, execute } = controlled();
  client.claim.mockResolvedValueOnce(task(3000));
  client.heartbeat.mockImplementationOnce(
    () =>
      new Promise((resolve) =>
        setTimeout(() => resolve(ok({ cancel: true, leaseMs: 3000 })), 500),
      ),
  );
  start(execute);
  await vi.advanceTimersByTimeAsync(1200);

  run.end({ outcome: 'succeeded' });
  await vi.advanceTimersByTimeAsync(300);

  expect(run.signal?.aborted).toBe(true);
  expect(client.complete.mock.calls).toEqual([
    [{ runner: 'r1', executionId: 'exe_1', outcome: 'succeeded' }],
  ]);
});
