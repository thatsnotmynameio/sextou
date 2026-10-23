// A task's states: open, then running, then a final one. A running task
// returns to open only when its lease expires with attempts left; an open one
// may also be cancelled before it runs.
export const Status = {
  open: 'open',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  skipped: 'skipped',
  cancelled: 'cancelled',
} as const;

export type Status = (typeof Status)[keyof typeof Status];

// How a task ended. A task in one never changes state again.
export const finalStatuses = [
  Status.succeeded,
  Status.failed,
  Status.skipped,
  Status.cancelled,
] as const;

export type FinalStatus = (typeof finalStatuses)[number];

// succeeded and skipped free the tasks a task blocks; failed and cancelled
// keep them waiting.
const freeing: ReadonlySet<unknown> = new Set<Status>([
  Status.succeeded,
  Status.skipped,
]);

// Whether a blocker in this state keeps the tasks it blocks waiting.
export function holds(status: unknown) {
  return !freeing.has(status);
}

// The states as a SQL list, for a column's check.
export const statusList = Object.values(Status)
  .map((status) => `'${status}'`)
  .join(', ');
