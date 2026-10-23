import type { Execute } from './runner';
import { sleep } from './sleep';

// Holds a task for `holdMs` and reports it succeeded, running nothing: what
// the runner executes until a task carries a Taskfile. An abort ends the hold
// at once.
export function hold(holdMs: number): Execute {
  return async (_task, { signal }) => {
    await sleep(holdMs, signal);
    return signal.aborted
      ? { outcome: 'failed', reason: 'aborted' }
      : { outcome: 'succeeded' };
  };
}
