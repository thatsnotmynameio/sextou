import type { Refusal, Refused } from './tasks';
import type { Logger } from './trpc';

export interface LeaseSweep {
  // Stops sweeping, after the sweep in progress ends.
  stop: () => Promise<void>;
}

// Calls expire every intervalMs, counted from the end of the last call, so
// a slow database never piles sweeps up. A call that rejects or is refused
// is logged and the next one still runs; a sweep that ended attempts says
// how many.
export function startLeaseSweep({
  expire,
  intervalMs,
  logger,
}: {
  expire: () => Promise<{ ok: true; expired: number } | Refused<Refusal>>;
  intervalMs: number;
  logger: Logger;
}): LeaseSweep {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  let stopped = false;

  const sweep = async () => {
    try {
      const result = await expire();
      if (!result.ok) {
        logger.error(
          { refusal: result.refusal },
          'Could not end expired leases',
        );
      } else if (result.expired > 0) {
        logger.info({ expired: result.expired }, 'Ended expired leases');
      }
    } catch (error) {
      logger.error({ err: error }, 'Could not end expired leases');
    }
  };

  const schedule = () => {
    timer = setTimeout(() => {
      running = sweep().then(() => {
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
