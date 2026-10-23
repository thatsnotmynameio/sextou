import type { RunnerClient } from './client';
import type { Logger } from './logger';

export interface RunnerOptions {
  client: RunnerClient;
  // The runner's name, and the assignees whose tasks it takes.
  name: string;
  assignees: string[];
  // How long it waits before it claims again, when there was no task or no
  // answer, and before it sends a completion again.
  pollMs: number;
  // How long it holds a task before it completes it as succeeded.
  holdMs: number;
  logger: Logger;
  // A new claimId, unique for this runner.
  newId: () => string;
}

type Claimed = Extract<
  Awaited<ReturnType<RunnerClient['claim']>>,
  { ok: true }
>['value'];
type Held = Exclude<Claimed, { task: null }>;
type Outcome = 'succeeded' | 'cancelled';

// Claims a task, holds it for holdMs with a heartbeat every third of its
// lease, and completes it as succeeded, or as cancelled once a heartbeat says
// someone asked to cancel it. It runs nothing: a task only shows the runner
// can talk to the server. stop() sends no new call, waits for the one in
// flight and resolves; a task it held is left to the server's lease sweep.
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
    await hold(options, claimed.value, signal);
  }
}

async function hold(options: RunnerOptions, held: Held, signal: AbortSignal) {
  const { client, holdMs, logger } = options;
  const ids = {
    taskId: held.task.id,
    executionId: held.execution.id,
    attempt: held.execution.attempt,
  };
  logger.info(ids, 'claimed');
  const deadline = Date.now() + holdMs;
  // Each answer carries the lease the server has now, which paces the next
  // heartbeat.
  let leaseMs = held.execution.leaseMs;
  let next = Date.now() + leaseMs / 3;
  while (next < deadline) {
    await sleep(next - Date.now(), signal);
    if (signal.aborted) {
      return;
    }
    const beat = await client.heartbeat(ids.executionId);
    if (beat.ok) {
      leaseMs = beat.value.leaseMs;
      logger.debug({ ...ids, cancel: beat.value.cancel }, 'heartbeat');
      if (beat.value.cancel) {
        return complete(options, ids, 'cancelled', signal);
      }
    } else if (beat.failure === 'lease_lost') {
      logger.warn(ids, 'lease lost');
      return;
    } else {
      logger.warn(
        { ...ids, failure: beat.failure, message: beat.message },
        'heartbeat failed',
      );
    }
    next = Date.now() + leaseMs / 3;
  }
  await sleep(deadline - Date.now(), signal);
  await complete(options, ids, 'succeeded', signal);
}

// A completion whose answer didn't arrive is sent again as it was, which the
// server accepts once more, until it answers or the lease is lost.
async function complete(
  { client, name, pollMs, logger }: RunnerOptions,
  ids: { taskId: string; executionId: string; attempt: number },
  outcome: Outcome,
  signal: AbortSignal,
) {
  while (!signal.aborted) {
    const done = await client.complete({
      runner: name,
      executionId: ids.executionId,
      outcome,
    });
    if (done.ok) {
      logger.info({ ...ids, outcome }, 'completed');
      return;
    }
    if (done.failure === 'lease_lost') {
      logger.warn(ids, 'lease lost');
      return;
    }
    logger.warn(
      { ...ids, outcome, failure: done.failure, message: done.message },
      'complete failed',
    );
    await sleep(pollMs, signal);
  }
}

// Resolves once `ms` pass, or at once when the signal aborts.
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      // Each sleep adds a listener to the runner's one signal: without this,
      // they pile up for as long as the runner runs, which no test sees.
      // Stryker disable next-line StringLiteral,CallExpression: a leak only
      signal.removeEventListener('abort', wake);
      resolve();
    };
    const timer = setTimeout(wake, ms);
    signal.addEventListener('abort', wake);
    if (signal.aborted) {
      wake();
    }
  });
}
