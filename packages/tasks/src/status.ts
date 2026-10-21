// A task's states: open, then running, then a final one. running never
// returns to open.
const statuses = ['open', 'running', 'succeeded', 'failed', 'skipped'] as const;

export type Status = (typeof statuses)[number];

// How a task ended. A task in one never changes state again.
export const finalStatuses = [
  'succeeded',
  'failed',
  'skipped',
] as const satisfies readonly Status[];

export type FinalStatus = (typeof finalStatuses)[number];

// succeeded and skipped free the tasks a task blocks; failed keeps them
// waiting.
const freeing: ReadonlySet<unknown> = new Set<Status>(['succeeded', 'skipped']);

export function isFinal(value: unknown): value is FinalStatus {
  return (finalStatuses as readonly unknown[]).includes(value);
}

// Whether a blocker in this state keeps the tasks it blocks waiting.
export function holds(status: unknown) {
  return !freeing.has(status);
}

// The states as a SQL list, for a column's check.
export const statusList = statuses.map((status) => `'${status}'`).join(', ');
