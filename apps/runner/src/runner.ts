import type { RunnerClient } from './client';
import type { Logger } from './logger';
import { sleep } from './sleep';

// What a claim answers: a task and its attempt, or no task.
export type Claimed = Extract<
  Awaited<ReturnType<RunnerClient['claim']>>,
  { ok: true }
>['value'];
type Held = Exclude<Claimed, { task: null }>;
export type Task = Held['task'];

// How running a task ended. A run whose signal aborted ends as it may: the
// runner reads its result only when it wasn't the one that aborted it.
export type Result =
  | { outcome: 'succeeded' }
  | { outcome: 'failed'; reason: string };

// Runs a task, and stops it once the signal aborts. Its logger is the
// runner's, bound to the task's ids.
export type Execute = (
  task: Task,
  run: { signal: AbortSignal; logger: Logger },
) => Promise<Result>;

export interface RunnerOptions {
  client: RunnerClient;
  // The runner's name, and the assignees whose tasks it takes.
  name: string;
  assignees: string[];
  // How long it waits before it claims again, when there was no task or no
  // answer, and before it sends a completion again.
  pollMs: number;
  // Runs each task the runner claims.
  execute: Execute;
  logger: Logger;
  // A new claimId, unique for this runner.
  newId: () => string;
}

type Ids = { taskId: string; executionId: string; attempt: number };
type Outcome = Result['outcome'] | 'cancelled';

// Claims a task, executes it with a heartbeat every third of its lease, and
// completes it with how the run ended, or as cancelled once a heartbeat says
// someone asked to cancel it, which stops the run. A lost lease, or one no
// heartbeat renewed in time, stops the run and drops the task. stop() sends no new call, stops the run, waits for it
// and for the call in flight, and resolves; a task it held is left to the
// server's lease sweep.
export function startRunner(options: RunnerOptions) {
  const controller = new AbortController();
  const done = run(options, controller.signal);
  return {
    stop: () => {
      controller.abort();
      return done;
    },
  };
}

async function run(options: RunnerOptions, signal: AbortSignal) {
  const { client, name, assignees, pollMs, logger, newId } = options;
  // A claim whose answer didn't arrive is sent again with the same claimId,
  // which gets the same attempt back: a new one only after an answer.
  let claimId = newId();
  while (!signal.aborted) {
    const sentAt = Date.now();
    const claimed = await client.claim({ claimId, runner: name, assignees });
    if (!claimed.ok) {
      logger.warn(
        { claimId, failure: claimed.failure, message: claimed.message },
        'claim failed',
      );
      await sleep(pollMs, signal);
      continue;
    }
    claimId = newId();
    if (claimed.value.task === null) {
      await sleep(pollMs, signal);
      continue;
    }
    await work(options, claimed.value, sentAt, signal);
  }
}

// The lease runs from when the server renewed it, which is before its answer
// arrives: each heartbeat goes a third of a lease after the last call was
// sent, the claim or a heartbeat, however long that call took to answer. A
// heartbeat that failed after a long wait is sent again at once. A lease no
// heartbeat renewed in time has run out on the server too, whose sweep may
// hand the task to another runner: the run stops as on a lost lease.
async function work(
  options: RunnerOptions,
  held: Held,
  claimSentAt: number,
  signal: AbortSignal,
) {
  const { client, execute, logger } = options;
  const ids: Ids = {
    taskId: held.task.id,
    executionId: held.execution.id,
    attempt: held.execution.attempt,
  };
  logger.info(ids, 'claimed');
  // Aborted to stop the run: by the runner's stop(), a cancel or a lost
  // lease. `finished` aborts once the run ended, which wakes the heartbeat.
  const stopRun = new AbortController();
  const finished = new AbortController();
  const result = Promise.resolve()
    .then(() =>
      execute(held.task, {
        signal: AbortSignal.any([signal, stopRun.signal]),
        logger: logger.child(ids),
      }),
    )
    .catch((error: unknown): Result => ({
      outcome: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    }))
    .finally(() => finished.abort());
  const wake = AbortSignal.any([signal, finished.signal]);
  // Each answer carries the lease the server has now, which paces the next
  // heartbeat and sets when the lease runs out.
  let leaseMs = held.execution.leaseMs;
  let next = claimSentAt + leaseMs / 3;
  let leaseEnd = claimSentAt + leaseMs;
  // A cancel stops the run, and the heartbeat keeps the lease while it winds
  // down. One that arrives once the run ended changes nothing.
  let cancelled = false;
  let lost = false;
  while (!lost) {
    await sleep(Math.min(next, leaseEnd) - Date.now(), wake);
    if (wake.aborted) {
      break;
    }
    if (Date.now() >= leaseEnd) {
      logger.warn(ids, 'lease expired');
      lost = true;
      break;
    }
    const sentAt = Date.now();
    const beat = await client.heartbeat(ids.executionId);
    if (beat.ok) {
      leaseMs = beat.value.leaseMs;
      leaseEnd = sentAt + leaseMs;
      logger.debug({ ...ids, cancel: beat.value.cancel }, 'heartbeat');
      if (beat.value.cancel && !finished.signal.aborted) {
        cancelled = true;
        stopRun.abort();
      }
    } else if (beat.failure === 'lease_lost') {
      logger.warn(ids, 'lease lost');
      lost = true;
    } else {
      logger.warn(
        { ...ids, failure: beat.failure, message: beat.message },
        'heartbeat failed',
      );
    }
    next = sentAt + leaseMs / 3;
  }
  stopRun.abort();
  const ran = await result;
  if (signal.aborted || lost) {
    return;
  }
  await complete(
    options,
    ids,
    cancelled ? { outcome: 'cancelled' } : ran,
    signal,
  );
}

// A completion whose answer didn't arrive, or that the server didn't serve in
// time, is sent again as it was, which the server accepts once more. One the
// server refused, the lease lost included, is dropped: sending it again gets
// the same answer.
async function complete(
  { client, name, pollMs, logger }: RunnerOptions,
  ids: Ids,
  result: { outcome: Outcome; reason?: string },
  signal: AbortSignal,
) {
  while (!signal.aborted) {
    const done = await client.complete({
      runner: name,
      executionId: ids.executionId,
      ...result,
    });
    if (done.ok) {
      logger.info({ ...ids, ...result }, 'completed');
      return;
    }
    if (done.failure === 'lease_lost') {
      logger.warn(ids, 'lease lost');
      return;
    }
    if (done.failure === 'refused') {
      logger.warn(
        { ...ids, ...result, message: done.message },
        'complete refused',
      );
      return;
    }
    logger.warn(
      { ...ids, ...result, failure: done.failure, message: done.message },
      'complete failed',
    );
    await sleep(pollMs, signal);
  }
}
