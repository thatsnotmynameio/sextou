import { randomBytes } from 'node:crypto';
import {
  and,
  type EmptyRelations,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  max,
  sql,
} from 'drizzle-orm';
import type { SQLiteAsyncTransaction } from 'drizzle-orm/sqlite-core';
import type {
  TursoDatabaseDatabase,
  TursoDatabaseRunResult,
} from 'drizzle-orm/tursodatabase';
import {
  openStatus,
  ready,
  taskExecutions,
  taskLinks,
  tasks,
  taskStatusChanges,
} from './schema';
import {
  assignTaskSchema,
  cancelTaskSchema,
  claimTaskSchema,
  createTaskSchema,
  expireExecutionsSchema,
  finishTaskSchema,
  linkSchema,
  listReadySchema,
  renewExecutionSchema,
  unlinkSchema,
} from './schemas';
import { type FinalStatus, holds, Status } from './status';

// Why an operation changed nothing.
export const Reason = {
  invalid: 'invalid',
  notFound: 'not_found',
  sameTask: 'same_task',
  notOpen: 'not_open',
  cycle: 'cycle',
  leaseLost: 'lease_lost',
  alreadyFinished: 'already_finished',
} as const;

export type Reason = (typeof Reason)[keyof typeof Reason];

export interface Refused<R extends Reason> {
  ok: false;
  reason: R;
}

export interface Task {
  // tsk_ and 32 hex digits. Not a sort key.
  id: string;
  title: string;
  // Any label the caller picks.
  kind: string;
  // 0 is the most urgent, 4 the least.
  priority: number;
  parentId: string | null;
  // Who may take the task: any name the caller uses, never checked.
  assignee: string;
  // What the task asks for.
  description: string | null;
  // A URL or a file path where the task's longer text lives. Stored as given
  // and never read.
  sourcePath: string | null;
  status: Status;
}

export interface NewTask {
  title: string;
  kind: string;
  priority: number;
  // Set only here: a parent organizes and never blocks.
  parentId?: string;
  assignee: string;
  // Blank is stored as null, as is a blank source path.
  description?: string;
  sourcePath?: string;
  // Recorded with the creation, the first change of the task's status.
  createdBy: string;
}

// The task is blocked by the blocker.
export interface Link {
  taskId: string;
  blockerId: string;
}

// An attempt at running a task, as the one who runs it sees it.
export interface Execution {
  // exe_ and 32 hex digits: the token every later call about the attempt
  // carries.
  id: string;
  // 1 for a task's first attempt, one more for each after.
  attempt: number;
  // When the lease ends unless renewed, in milliseconds since the epoch.
  expiresAt: number;
}

// Every operation that writes runs in one transaction: a refusal writes
// nothing, and an error from Turso or the file system rejects. Each change of
// a task's status is recorded in that transaction, with when it happened and
// who made it: any name the caller uses, never checked.
//
// A running task's current attempt holds a lease until it ends: only a call
// that carries that attempt's id may renew it or finish the task, so one who
// lost the lease can't overwrite a later attempt.
export interface Graph {
  createTask: (
    task: NewTask,
  ) => Promise<
    | { ok: true; task: Task }
    | Refused<typeof Reason.invalid | typeof Reason.notFound>
  >;
  // Refuses a link that would close a cycle, or whose task isn't open. A pair
  // already linked succeeds and changes nothing.
  link: (
    link: Link,
  ) => Promise<
    | { ok: true }
    | Refused<
        | typeof Reason.invalid
        | typeof Reason.notFound
        | typeof Reason.sameTask
        | typeof Reason.notOpen
        | typeof Reason.cycle
      >
  >;
  // Refuses a task that isn't open. A pair not linked succeeds and changes
  // nothing.
  unlink: (
    link: Link,
  ) => Promise<
    | { ok: true }
    | Refused<
        typeof Reason.invalid | typeof Reason.notFound | typeof Reason.notOpen
      >
  >;
  // Moves the ready task listReady would list first for these assignees to
  // running and starts its next attempt, leased for leaseMs, in one write, so
  // two claims never take the same task. The actor runs it and is recorded as
  // who started it. task is null when none is ready.
  claimTask: (claim: {
    assignees: string[];
    actor: string;
    leaseMs: number;
  }) => Promise<
    | { ok: true; task: Task; execution: Execution }
    | { ok: true; task: null }
    | Refused<typeof Reason.invalid>
  >;
  // Pushes the attempt's lease to leaseMs from now, and says whether someone
  // asked to cancel its task. Refuses, as lease_lost, an attempt that doesn't
  // exist or ended, by finishTask or expireExecutions. A lease past its
  // expiry that expireExecutions hasn't ended yet still renews: no other
  // attempt can have started.
  renewExecution: (renew: {
    executionId: string;
    leaseMs: number;
  }) => Promise<
    | { ok: true; expiresAt: number; cancelRequested: boolean }
    | Refused<typeof Reason.invalid | typeof Reason.leaseLost>
  >;
  // Ends the attempt and moves its task to a final state, judging the lease
  // as renewExecution does. The one who finishes it need not be the one who
  // started it.
  finishTask: (finish: {
    executionId: string;
    changedBy: string;
    status: FinalStatus;
    // Why it ended so, recorded with the change; blank is null.
    reason?: string;
    // Where the run's result is, recorded on its attempt. Stored as given
    // and never read; blank is null.
    resultPath?: string;
  }) => Promise<
    { ok: true } | Refused<typeof Reason.invalid | typeof Reason.leaseLost>
  >;
  // Cancels an open task at once. For a running task, records the request on
  // its current attempt, which renewExecution reports to the one who runs
  // it; a second request changes nothing. status is the task's state after.
  // Refuses a task already in a final state.
  cancelTask: (cancel: {
    id: string;
    changedBy: string;
    // Why, recorded with the change or the request; blank is null.
    reason?: string;
  }) => Promise<
    | { ok: true; status: typeof Status.cancelled | typeof Status.running }
    | Refused<
        | typeof Reason.invalid
        | typeof Reason.notFound
        | typeof Reason.alreadyFinished
      >
  >;
  // Changes who may take an open task. Refuses a task that isn't open.
  assignTask: (assign: {
    id: string;
    assignee: string;
    changedBy: string;
  }) => Promise<
    | { ok: true }
    | Refused<
        typeof Reason.invalid | typeof Reason.notFound | typeof Reason.notOpen
      >
  >;
  // Ends every attempt whose lease expired. Its task is cancelled when
  // someone asked for it, recorded as theirs; else it opens again while the
  // attempt is below maxAttempts; else it fails. expired counts the attempts
  // it ended.
  expireExecutions: (expire: {
    maxAttempts: number;
    changedBy: string;
  }) => Promise<{ ok: true; expired: number } | Refused<typeof Reason.invalid>>;
  // The open tasks no blocker holds whose assignee is one of assignees,
  // matched exactly, most urgent first, then oldest, at most limit of them.
  listReady: (query: {
    assignees: string[];
    limit: number;
  }) => Promise<{ ok: true; tasks: Task[] } | Refused<typeof Reason.invalid>>;
}

// A write's transaction. Inside a write, every query runs on it: one on db,
// or prepared on it, would wait for the lock the transaction holds.
type Transaction = SQLiteAsyncTransaction<
  'async',
  TursoDatabaseRunResult,
  EmptyRelations
>;

// A task's columns, as Task has them.
const taskColumns = {
  id: tasks.id,
  title: tasks.title,
  kind: tasks.kind,
  priority: tasks.priority,
  parentId: tasks.parentId,
  assignee: tasks.assignee,
  description: tasks.description,
  sourcePath: tasks.sourcePath,
  status: tasks.status,
};

// Why a lease that ran out ended its attempt.
const leaseExpired = 'lease expired';

// Thrown out of a write's transaction, so that a refusal rolls it back.
class Refusal {
  constructor(readonly result: unknown) {}
}

function refuse<R extends Reason>(reason: R): Refused<R> {
  return { ok: false, reason };
}

function find(tx: Transaction, id: string) {
  return tx
    .select({ status: tasks.status })
    .from(tasks)
    .where(eq(tasks.id, id))
    .get();
}

// The ready tasks of these assignees: task_ready's condition, with one
// parameter per assignee. Turso searches that index once per assignee, then
// sorts only the rows it found; it scans the whole index for assignees read
// from a JSON array.
function readyFor(assignees: string[]) {
  return and(inArray(tasks.assignee, assignees), ready);
}

// Most urgent first, then oldest: rowid is the order of creation.
const readyOrder = [tasks.priority, sql`rowid`];

// The attempt that holds a lease: one that hasn't ended.
function leased(executionId: string) {
  return and(
    eq(taskExecutions.id, executionId),
    isNotNull(taskExecutions.expiresAt),
  );
}

// A task's count of holding blockers, one up or one down. The builder has no
// increment.
const oneMore = sql`${tasks.holdingBlockers} + 1`;
const oneLess = sql`${tasks.holdingBlockers} - 1`;

// Whether the second task is reachable from the first through open blockers.
// A task that ran has only succeeded or skipped blockers, and a cancelled one
// never runs, so a path that could deadlock open tasks never runs through
// either. drizzle's builder has no recursive query.
function reaches(tx: Transaction, from: string, to: string) {
  return tx.get(sql`WITH RECURSIVE reached (id) AS (
  SELECT ${from}
  UNION
  SELECT ${taskLinks.blockerId} FROM reached
  JOIN ${taskLinks} ON ${taskLinks.taskId} = reached.id
  JOIN ${tasks} ON ${tasks.id} = ${taskLinks.blockerId} AND ${tasks.status} = ${openStatus}
)
SELECT 1 FROM reached WHERE id = ${to} LIMIT 1`);
}

// One level of a logger: a message, or fields and then a message.
interface LogMethod {
  (msg: string): void;
  (fields: object, msg?: string): void;
}

// The logger the graph writes through, by the methods it would call, so the
// package needs no logging library: a Pino logger is one.
export interface Logger {
  fatal: LogMethod;
  error: LogMethod;
  warn: LogMethod;
  info: LogMethod;
  debug: LogMethod;
  trace: LogMethod;
}

// The graph's operations over a migrated database. Readiness is kept in each
// task's holding_blockers, which every write moves in the same transaction:
// it always counts the task's blockers that hold it. The logger is there for
// the graph's code; nothing in it logs yet. now is the clock every recorded
// time and lease reads.
export function createGraph(
  db: TursoDatabaseDatabase,
  _logger: Logger,
  now: () => number,
): Graph {
  // Runs fn in an immediate transaction, which takes the write lock first, so
  // its checks and its writes see the same graph. Turso holds the connection
  // until the transaction ends: another operation waits for it. A refusal is
  // thrown out of the transaction, so only a success commits.
  async function write<T extends { ok: boolean }>(
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await db.transaction(
        async (tx) => {
          const result = await fn(tx);
          if (!result.ok) {
            throw new Refusal(result);
          }
          return result;
        },
        { behavior: 'immediate' },
      );
    } catch (error) {
      if (error instanceof Refusal) {
        return error.result as T;
      }
      throw error;
    }
  }

  // Records a change of a task's status, now, inside the caller's write.
  async function recordChange(
    tx: Transaction,
    taskId: string,
    fromStatus: Status | null,
    toStatus: Status,
    changedBy: string,
    reason: string | null = null,
  ) {
    await tx.insert(taskStatusChanges).values({
      taskId,
      fromStatus,
      toStatus,
      changedBy,
      reason,
      timeChanged: now(),
    });
  }

  // Moves a ready task to running and starts its next attempt, run by the
  // actor.
  async function begin(
    tx: Transaction,
    taskId: string,
    actor: string,
    leaseMs: number,
  ): Promise<Execution> {
    const last = await tx
      .select({ attempt: max(taskExecutions.attempt) })
      .from(taskExecutions)
      .where(eq(taskExecutions.taskId, taskId))
      .get();
    const execution: Execution = {
      id: `exe_${randomBytes(16).toString('hex')}`,
      attempt: (last?.attempt ?? 0) + 1,
      expiresAt: now() + leaseMs,
    };
    await tx
      .update(tasks)
      .set({ status: Status.running })
      .where(eq(tasks.id, taskId));
    await recordChange(tx, taskId, Status.open, Status.running, actor);
    await tx.insert(taskExecutions).values({ ...execution, taskId, actor });
    return execution;
  }

  // Ends a running task's attempt in a final state. The tasks it blocks are
  // open or cancelled: a task it held never started since.
  async function end(
    tx: Transaction,
    taskId: string,
    executionId: string,
    status: FinalStatus,
    changedBy: string,
    reason: string | null,
    resultPath?: string | null,
  ) {
    await tx.update(tasks).set({ status }).where(eq(tasks.id, taskId));
    await recordChange(tx, taskId, Status.running, status, changedBy, reason);
    await tx
      .update(taskExecutions)
      .set({ expiresAt: null, resultPath })
      .where(eq(taskExecutions.id, executionId));
    if (!holds(status)) {
      await tx
        .update(tasks)
        .set({ holdingBlockers: oneLess })
        .where(
          inArray(
            tasks.id,
            tx
              .select({ taskId: taskLinks.taskId })
              .from(taskLinks)
              .where(eq(taskLinks.blockerId, taskId)),
          ),
        );
    }
  }

  return {
    createTask: async (input) => {
      const parsed = createTaskSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { parentId, createdBy, ...fields } = parsed.data;
      return write(async (tx) => {
        if (
          parentId !== undefined &&
          (await find(tx, parentId)) === undefined
        ) {
          return refuse(Reason.notFound);
        }
        const task: Task = {
          id: `tsk_${randomBytes(16).toString('hex')}`,
          ...fields,
          parentId: parentId ?? null,
          status: Status.open,
        };
        await tx.insert(tasks).values(task);
        await recordChange(tx, task.id, null, Status.open, createdBy);
        return { ok: true, task };
      });
    },

    link: async (input) => {
      const parsed = linkSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { taskId, blockerId } = parsed.data;
      return write(async (tx) => {
        const task = await find(tx, taskId);
        const blocker = await find(tx, blockerId);
        if (task === undefined || blocker === undefined) {
          return refuse(Reason.notFound);
        }
        if (taskId === blockerId) {
          return refuse(Reason.sameTask);
        }
        const linked = await tx
          .select({ taskId: taskLinks.taskId })
          .from(taskLinks)
          .where(
            and(
              eq(taskLinks.taskId, taskId),
              eq(taskLinks.blockerId, blockerId),
            ),
          )
          .get();
        if (linked !== undefined) {
          return { ok: true };
        }
        if (task.status !== Status.open) {
          return refuse(Reason.notOpen);
        }
        // A blocker past open reaches no open task.
        if (
          blocker.status === Status.open &&
          (await reaches(tx, blockerId, taskId)) !== undefined
        ) {
          return refuse(Reason.cycle);
        }
        if (holds(blocker.status)) {
          await tx
            .update(tasks)
            .set({ holdingBlockers: oneMore })
            .where(eq(tasks.id, taskId));
        }
        await tx.insert(taskLinks).values({ taskId, blockerId });
        return { ok: true };
      });
    },

    unlink: async (input) => {
      const parsed = unlinkSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { taskId, blockerId } = parsed.data;
      return write(async (tx) => {
        const task = await find(tx, taskId);
        const blocker = await find(tx, blockerId);
        if (task === undefined || blocker === undefined) {
          return refuse(Reason.notFound);
        }
        if (task.status !== Status.open) {
          return refuse(Reason.notOpen);
        }
        const { changes } = await tx
          .delete(taskLinks)
          .where(
            and(
              eq(taskLinks.taskId, taskId),
              eq(taskLinks.blockerId, blockerId),
            ),
          );
        if (changes > 0 && holds(blocker.status)) {
          await tx
            .update(tasks)
            .set({ holdingBlockers: oneLess })
            .where(eq(tasks.id, taskId));
        }
        return { ok: true };
      });
    },

    claimTask: async (input) => {
      const parsed = claimTaskSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { assignees, actor, leaseMs } = parsed.data;
      return write(async (tx) => {
        const task = await tx
          .select(taskColumns)
          .from(tasks)
          .where(readyFor(assignees))
          .orderBy(...readyOrder)
          .limit(1)
          .get();
        if (task === undefined) {
          return { ok: true, task: null };
        }
        const execution = await begin(tx, task.id, actor, leaseMs);
        return {
          ok: true,
          task: { ...task, status: Status.running },
          execution,
        };
      });
    },

    renewExecution: async (input) => {
      const parsed = renewExecutionSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { executionId, leaseMs } = parsed.data;
      return write(async (tx) => {
        const execution = await tx
          .select({ cancelRequestedBy: taskExecutions.cancelRequestedBy })
          .from(taskExecutions)
          .where(leased(executionId))
          .get();
        if (execution === undefined) {
          return refuse(Reason.leaseLost);
        }
        const expiresAt = now() + leaseMs;
        await tx
          .update(taskExecutions)
          .set({ expiresAt })
          .where(eq(taskExecutions.id, executionId));
        return {
          ok: true,
          expiresAt,
          cancelRequested: execution.cancelRequestedBy !== null,
        };
      });
    },

    finishTask: async (input) => {
      const parsed = finishTaskSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { executionId, changedBy, status, reason, resultPath } =
        parsed.data;
      return write(async (tx) => {
        const execution = await tx
          .select({ taskId: taskExecutions.taskId })
          .from(taskExecutions)
          .where(leased(executionId))
          .get();
        if (execution === undefined) {
          return refuse(Reason.leaseLost);
        }
        await end(
          tx,
          execution.taskId,
          executionId,
          status,
          changedBy,
          reason,
          resultPath,
        );
        return { ok: true };
      });
    },

    cancelTask: async (input) => {
      const parsed = cancelTaskSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { id, changedBy, reason } = parsed.data;
      return write(async (tx) => {
        const task = await find(tx, id);
        if (task === undefined) {
          return refuse(Reason.notFound);
        }
        if (task.status === Status.open) {
          // Cancelled holds the tasks it blocks, as open did: no counter
          // moves.
          await tx
            .update(tasks)
            .set({ status: Status.cancelled })
            .where(eq(tasks.id, id));
          await recordChange(
            tx,
            id,
            Status.open,
            Status.cancelled,
            changedBy,
            reason,
          );
          return { ok: true, status: Status.cancelled };
        }
        if (task.status === Status.running) {
          await tx
            .update(taskExecutions)
            .set({ cancelRequestedBy: changedBy, cancelReason: reason })
            .where(
              and(
                eq(taskExecutions.taskId, id),
                isNotNull(taskExecutions.expiresAt),
                isNull(taskExecutions.cancelRequestedBy),
              ),
            );
          return { ok: true, status: Status.running };
        }
        return refuse(Reason.alreadyFinished);
      });
    },

    assignTask: async (input) => {
      const parsed = assignTaskSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { id, assignee } = parsed.data;
      return write(async (tx) => {
        const task = await find(tx, id);
        if (task === undefined) {
          return refuse(Reason.notFound);
        }
        if (task.status !== Status.open) {
          return refuse(Reason.notOpen);
        }
        await tx.update(tasks).set({ assignee }).where(eq(tasks.id, id));
        return { ok: true };
      });
    },

    expireExecutions: async (input) => {
      const parsed = expireExecutionsSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { maxAttempts, changedBy } = parsed.data;
      return write(async (tx) => {
        // The condition holds task_execution_lease's, so Turso searches it.
        const expired = await tx
          .select({
            id: taskExecutions.id,
            taskId: taskExecutions.taskId,
            attempt: taskExecutions.attempt,
            cancelRequestedBy: taskExecutions.cancelRequestedBy,
            cancelReason: taskExecutions.cancelReason,
          })
          .from(taskExecutions)
          .where(
            and(
              isNotNull(taskExecutions.expiresAt),
              lte(taskExecutions.expiresAt, now()),
            ),
          );
        for (const execution of expired) {
          if (execution.cancelRequestedBy !== null) {
            await end(
              tx,
              execution.taskId,
              execution.id,
              Status.cancelled,
              execution.cancelRequestedBy,
              execution.cancelReason,
            );
          } else if (execution.attempt < maxAttempts) {
            // Back to open, still holding the tasks it blocks, as running
            // did: no counter moves. It was ready when it started, and no
            // link reaches a task past open, so it is ready again.
            await tx
              .update(tasks)
              .set({ status: Status.open })
              .where(eq(tasks.id, execution.taskId));
            await recordChange(
              tx,
              execution.taskId,
              Status.running,
              Status.open,
              changedBy,
              leaseExpired,
            );
            await tx
              .update(taskExecutions)
              .set({ expiresAt: null })
              .where(eq(taskExecutions.id, execution.id));
          } else {
            await end(
              tx,
              execution.taskId,
              execution.id,
              Status.failed,
              changedBy,
              leaseExpired,
            );
          }
        }
        return { ok: true, expired: expired.length };
      });
    },

    // Waits for a write in progress, so it reads the graph between writes.
    listReady: async (input) => {
      const parsed = listReadySchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { assignees, limit } = parsed.data;
      const rows = await db
        .select(taskColumns)
        .from(tasks)
        .where(readyFor(assignees))
        .orderBy(...readyOrder)
        .limit(limit);
      return { ok: true, tasks: rows };
    },
  };
}
