// The server's tasks as procedures see them: their types and the Tasks port
// the context carries. Nothing here may need Node, since the web app's
// typecheck follows the router into this file; tasks-service.ts implements
// the port over @sextou/tasks, and only main.ts imports it.

// Who acts: a person, an agent or a runner, by name.
export interface Actor {
  name: string;
}

// 0 is the most urgent, 4 the least.
export type Priority = 0 | 1 | 2 | 3 | 4;

// A task's states: open, then running, then how it ended. A running task
// opens again when its lease expires with attempts left.
export const Status = {
  open: 'open',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  skipped: 'skipped',
  cancelled: 'cancelled',
} as const;

export type Status = (typeof Status)[keyof typeof Status];

// How a task ends.
export const Outcome = {
  succeeded: Status.succeeded,
  failed: Status.failed,
  skipped: Status.skipped,
  cancelled: Status.cancelled,
} as const;

export type Outcome = (typeof Outcome)[keyof typeof Outcome];

export interface Task {
  id: string;
  title: string;
  kind: string;
  priority: Priority;
  parentId: string | null;
  assignee: Actor;
  description: string | null;
  // A URL or a file path where the task's longer text lives.
  source: string | null;
  status: Status;
}

export interface NewTask {
  title: string;
  kind: string;
  priority: Priority;
  parentId?: string;
  assignee: Actor;
  description?: string;
  source?: string;
  createdBy: Actor;
}

// An attempt a runner holds, as the runner sees it.
export interface Execution {
  // The token every later call about the attempt carries.
  id: string;
  // 1 for the task's first attempt, one more for each after.
  attempt: number;
  // How long the lease lasts unless renewed, in milliseconds.
  leaseMs: number;
}

// Why a call wrote nothing.
export const Refusal = {
  invalid: 'invalid',
  notFound: 'not_found',
  notOpen: 'not_open',
  leaseLost: 'lease_lost',
  alreadyFinished: 'already_finished',
} as const;

export type Refusal = (typeof Refusal)[keyof typeof Refusal];

export interface Refused<R extends Refusal> {
  ok: false;
  refusal: R;
}

// What procedures reach through the context. A refusal is a result; an error
// from the database rejects.
export interface Tasks {
  create: (
    task: NewTask,
  ) => Promise<
    | { ok: true; task: Task }
    | Refused<typeof Refusal.invalid | typeof Refusal.notFound>
  >;
  // The runner takes the most urgent ready task of the assignees it serves,
  // then the oldest, and holds it under a lease. task is null when none is
  // ready.
  claim: (claim: {
    runner: Actor;
    assignees: Actor[];
  }) => Promise<
    | { ok: true; task: Task; execution: Execution }
    | { ok: true; task: null }
    | Refused<typeof Refusal.invalid>
  >;
  // Renews the attempt's lease, and says whether someone asked to cancel its
  // task.
  renew: (
    executionId: string,
  ) => Promise<
    | { ok: true; cancel: boolean }
    | Refused<typeof Refusal.invalid | typeof Refusal.leaseLost>
  >;
  // The runner that holds the attempt ends its task.
  finish: (finish: {
    executionId: string;
    runner: Actor;
    outcome: Outcome;
    reason?: string;
  }) => Promise<
    { ok: true } | Refused<typeof Refusal.invalid | typeof Refusal.leaseLost>
  >;
  // Cancels an open task at once, or asks the runner of a running one to
  // cancel it. status is the task's state after.
  cancel: (cancel: {
    taskId: string;
    actor: Actor;
    reason?: string;
  }) => Promise<
    | { ok: true; status: typeof Status.cancelled | typeof Status.running }
    | Refused<
        | typeof Refusal.invalid
        | typeof Refusal.notFound
        | typeof Refusal.alreadyFinished
      >
  >;
  // Hands an open task to another assignee.
  assign: (assign: {
    taskId: string;
    assignee: Actor;
    actor: Actor;
  }) => Promise<
    | { ok: true }
    | Refused<
        | typeof Refusal.invalid
        | typeof Refusal.notFound
        | typeof Refusal.notOpen
      >
  >;
}
