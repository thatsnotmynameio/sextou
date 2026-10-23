import { Status } from './tasks';
import type { ExpiredAttempt, Refusal, Refused } from './tasks';
import type { Logger } from './trpc';

export interface LeaseSweep {
  // Stops sweeping, after the sweep in progress ends.
  stop: () => Promise<void>;
}

// Calls expire every intervalMs, counted from the end of the last call, so
// a slow database never piles sweeps up. A call that rejects or is refused
// is logged and the next one still runs. Each attempt a sweep ended is
// logged with its task: as a warning when the task failed, which no runner
// reports.
//
// A lease expires by the wall clock, which runs on while the server answers
// no heartbeat: before it starts, while the host sleeps, when its clock
// jumps ahead. So no sweep runs until the server has been up a whole lease,
// leaseMs, and a sweep that comes later than a heartbeat's interval, a third
// of the lease, past its time waits a whole lease again: the runners that
// still hold their tasks renew them first.
export function startLeaseSweep({
  expire,
  intervalMs,
  leaseMs,
  logger,
}: {
  expire: () => Promise<
    { ok: true; expired: ExpiredAttempt[] } | Refused<Refusal>
  >;
  intervalMs: number;
  leaseMs: number;
  logger: Logger;
}): LeaseSweep {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  let stopped = false;
  let upSince = Date.now();
  let scheduledAt = upSince;

  const sweep = async () => {
    try {
      const result = await expire();
      if (!result.ok) {
        logger.error(
          { refusal: result.refusal },
          'Could not end expired leases',
        );
      } else {
        for (const attempt of result.expired) {
          if (attempt.status === Status.failed) {
            logger.warn(attempt, 'Failed a task whose lease expired');
          } else {
            logger.info(attempt, 'Ended an expired lease');
          }
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'Could not end expired leases');
    }
  };

  const tick = async () => {
    const now = Date.now();
    const lateMs = now - scheduledAt - intervalMs;
    if (lateMs > leaseMs / 3) {
      upSince = now;
      logger.warn(
        { lateMs },
        'The lease sweep ran late: ending no lease until the runners renew',
      );
    }
    if (now - upSince >= leaseMs) {
      await sweep();
    }
  };

  const schedule = () => {
    scheduledAt = Date.now();
    timer = setTimeout(() => {
      running = tick().then(() => {
        if (!stopped) {
          schedule();
        }
      });
    }, intervalMs);
  };

  schedule();
  return {
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
