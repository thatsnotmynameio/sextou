// A task's states: open, then running, then a final one. running never
// returns to open.
export const Status = {
  open: 'open',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  skipped: 'skipped',
} as const;

export type Status = (typeof Status)[keyof typeof Status];

// How a task ended. A task in one never changes state again.
export const finalStatuses = [
  Status.succeeded,
  Status.failed,
  Status.skipped,
] as const;

export type FinalStatus = (typeof finalStatuses)[number];

// succeeded and skipped free the tasks a task blocks; failed keeps them
// waiting.
const freeing: ReadonlySet<unknown> = new Set<Status>([
  Status.succeeded,
  Status.skipped,
]);

export function isFinal(value: unknown): value is FinalStatus {
  return (finalStatuses as readonly unknown[]).includes(value);
}

// Whether a blocker in this state keeps the tasks it blocks waiting.
export function holds(status: unknown) {
  return !freeing.has(status);
}

// The states as a SQL list, for a column's check.
export const statusList = Object.values(Status)
  .map((status) => `'${status}'`)
  .join(', ');
