import { randomBytes } from 'node:crypto';
import { and, type EmptyRelations, eq, inArray, sql } from 'drizzle-orm';
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
  createTaskSchema,
  finishTaskSchema,
  linkSchema,
  listReadySchema,
  startTaskSchema,
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
  blocked: 'blocked',
  notRunning: 'not_running',
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

// Every operation that writes runs in one transaction: a refusal writes
// nothing, and an error from Turso or the file system rejects. Each change of
// a task's status is recorded in that transaction, with when it happened and
// who made it: any name the caller uses, never checked.
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
  // Moves a ready task to running and records its execution. Refuses a task
  // that isn't open, or that a blocker still holds.
  startTask: (start: {
    id: string;
    changedBy: string;
    // Who runs the task, kept apart from who started it.
    actor: string;
    // Where the run's log is. Stored as given and never read; blank is null.
    logPath?: string;
  }) => Promise<
    | { ok: true }
    | Refused<
        | typeof Reason.invalid
        | typeof Reason.notFound
        | typeof Reason.notOpen
        | typeof Reason.blocked
      >
  >;
  // Moves a running task to a final state. The one who finishes it need not
  // be the one who started it.
  finishTask: (finish: {
    id: string;
    changedBy: string;
    status: FinalStatus;
    // Why it ended so, recorded with the change; blank is null.
    reason?: string;
    // Where the run's result is, recorded on its execution. Stored as given
    // and never read; blank is null.
    resultPath?: string;
  }) => Promise<
    | { ok: true }
    | Refused<
        | typeof Reason.invalid
        | typeof Reason.notFound
        | typeof Reason.notRunning
      >
  >;
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

// Thrown out of a write's transaction, so that a refusal rolls it back.
class Refusal {
  constructor(readonly result: unknown) {}
}

function refuse<R extends Reason>(reason: R): Refused<R> {
  return { ok: false, reason };
}

function find(tx: Transaction, id: string) {
  return tx
    .select({ status: tasks.status, holdingBlockers: tasks.holdingBlockers })
    .from(tasks)
    .where(eq(tasks.id, id))
    .get();
}

// A task's count of holding blockers, one up or one down. The builder has no
// increment.
const oneMore = sql`${tasks.holdingBlockers} + 1`;
const oneLess = sql`${tasks.holdingBlockers} - 1`;

// Whether the second task is reachable from the first through open blockers.
// A task past open has only succeeded or skipped blockers, so a path to an
// open task never runs through one. drizzle's builder has no recursive query.
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
// task's holding_blockers, which every write moves in the same transaction,
// so no task past open is ever held by a blocker. The logger is there for
// the graph's code; nothing in it logs yet.
export function createGraph(db: TursoDatabaseDatabase, _logger: Logger): Graph {
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
      timeChanged: Date.now(),
    });
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

    startTask: async (input) => {
      const parsed = startTaskSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { id, changedBy, actor, logPath } = parsed.data;
      return write(async (tx) => {
        const task = await find(tx, id);
        if (task === undefined) {
          return refuse(Reason.notFound);
        }
        if (task.status !== Status.open) {
          return refuse(Reason.notOpen);
        }
        if (task.holdingBlockers > 0) {
          return refuse(Reason.blocked);
        }
        await tx
          .update(tasks)
          .set({ status: Status.running })
          .where(eq(tasks.id, id));
        await recordChange(tx, id, Status.open, Status.running, changedBy);
        await tx.insert(taskExecutions).values({ taskId: id, actor, logPath });
        return { ok: true };
      });
    },

    finishTask: async (input) => {
      const parsed = finishTaskSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { id, changedBy, status, reason, resultPath } = parsed.data;
      return write(async (tx) => {
        const task = await find(tx, id);
        if (task === undefined) {
          return refuse(Reason.notFound);
        }
        if (task.status !== Status.running) {
          return refuse(Reason.notRunning);
        }
        await tx.update(tasks).set({ status }).where(eq(tasks.id, id));
        await recordChange(tx, id, Status.running, status, changedBy, reason);
        // A running task has its execution, from its start.
        await tx
          .update(taskExecutions)
          .set({ resultPath })
          .where(eq(taskExecutions.taskId, id));
        // Every task it blocks is open: no task past open is held.
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
                  .where(eq(taskLinks.blockerId, id)),
              ),
            );
        }
        return { ok: true };
      });
    },

    // Waits for a write in progress, so it reads the graph between writes.
    listReady: async (input) => {
      const parsed = listReadySchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { assignees, limit } = parsed.data;
      // The WHERE holds task_ready's condition, so Turso searches that index
      // once per assignee, then sorts only the rows it found. It scans the
      // whole index for assignees read from a JSON array, hence one parameter
      // each.
      const rows = await db
        .select(taskColumns)
        .from(tasks)
        .where(and(inArray(tasks.assignee, assignees), ready))
        .orderBy(tasks.priority, sql`rowid`)
        .limit(limit);
      return { ok: true, tasks: rows };
    },
  };
}
