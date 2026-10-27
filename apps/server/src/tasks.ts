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
  // A JSON object the creator stores with the task, which the server never
  // reads: the repository and commit a reusable Taskfile works on, say.
  context: Record<string, unknown> | null;
  // The Taskfile a runner runs for the task, owner/name/path/to/Taskfile.yml@sha,
  // as its creator gave it, or null when it names none.
  uses: string | null;
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
  context?: Record<string, unknown>;
  // The ref is a full commit SHA: the tasks refuse any other as invalid.
  uses?: string;
  createdBy: Actor;
}

// A task's uses, split: the public GitHub repository, owner/name, the commit,
// and the Taskfile's path inside it.
export interface Uses {
  repo: string;
  sha: string;
  taskfile: string;
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

// An attempt whose lease expired, which the server ended, and the status its
// task took: open again while attempts are left, else failed, or cancelled
// when someone asked for it.
export interface ExpiredAttempt {
  taskId: string;
  executionId: string;
  attempt: number;
  status: typeof Status.open | typeof Status.failed | typeof Status.cancelled;
}

// Why a call wrote nothing.
export const Refusal = {
  invalid: 'invalid',
  notFound: 'not_found',
  // A task named as its own blocker.
  sameTask: 'same_task',
  notOpen: 'not_open',
  // A link that would make a task wait, through its blockers, for itself.
  cycle: 'cycle',
  leaseLost: 'lease_lost',
  alreadyFinished: 'already_finished',
  // The tasks database took longer than the server's timeout, and wrote
  // nothing.
  timeout: 'timeout',
} as const;

export type Refusal = (typeof Refusal)[keyof typeof Refusal];

export interface Refused<R extends Refusal> {
  ok: false;
  refusal: R;
}

// What procedures reach through the context. A refusal is a result; an error
// from the database rejects. Every call may be refused as timeout, having
// written nothing.
export interface Tasks {
  create: (
    task: NewTask,
  ) => Promise<
    | { ok: true; task: Task }
    | Refused<
        | typeof Refusal.invalid
        | typeof Refusal.notFound
        | typeof Refusal.timeout
      >
  >;
  // The runner takes the most urgent ready task of the assignees it serves,
  // then the oldest, and holds it under a lease. task is null when none is
  // ready. claimId is the runner's name for the claim: the same claim sent
  // again, when its answer was lost, gets the same attempt back while it
  // runs, and no task once it ended. uses is the task's uses split, or null
  // when it names none.
  claim: (claim: {
    claimId: string;
    runner: Actor;
    assignees: Actor[];
  }) => Promise<
    | { ok: true; task: Task; uses: Uses | null; execution: Execution }
    | { ok: true; task: null }
    | Refused<typeof Refusal.invalid | typeof Refusal.timeout>
  >;
  // Renews the attempt's lease for leaseMs, the server's lease now, and says
  // whether someone asked to cancel its task.
  renew: (
    executionId: string,
  ) => Promise<
    | { ok: true; cancel: boolean; leaseMs: number }
    | Refused<
        | typeof Refusal.invalid
        | typeof Refusal.leaseLost
        | typeof Refusal.timeout
      >
  >;
  // The runner that holds the attempt ends its task. The same finish sent
  // again succeeds.
  finish: (finish: {
    executionId: string;
    runner: Actor;
    outcome: Outcome;
    reason?: string;
  }) => Promise<
    | { ok: true }
    | Refused<
        | typeof Refusal.invalid
        | typeof Refusal.leaseLost
        | typeof Refusal.timeout
      >
  >;
  // Cancels an open task at once, or asks the runner of a running one to
  // cancel it. status is the task's state after. The same cancel sent again
  // succeeds.
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
        | typeof Refusal.timeout
      >
  >;
  // Makes an open task wait for its blocker: the task is ready only once each
  // of its blockers succeeded or was skipped. A pair already linked succeeds
  // and changes nothing, whatever the task's state.
  link: (link: {
    taskId: string;
    blockerId: string;
  }) => Promise<
    | { ok: true }
    | Refused<
        | typeof Refusal.invalid
        | typeof Refusal.notFound
        | typeof Refusal.sameTask
        | typeof Refusal.notOpen
        | typeof Refusal.cycle
        | typeof Refusal.timeout
      >
  >;
  // Stops an open task waiting for its blocker. A pair not linked succeeds
  // and changes nothing.
  unlink: (link: {
    taskId: string;
    blockerId: string;
  }) => Promise<
    | { ok: true }
    | Refused<
        | typeof Refusal.invalid
        | typeof Refusal.notFound
        | typeof Refusal.notOpen
        | typeof Refusal.timeout
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
        | typeof Refusal.timeout
      >
  >;
}
