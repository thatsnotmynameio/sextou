import { randomBytes } from 'node:crypto';
import type { Database, Transaction } from '@tursodatabase/database';
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

// The statements the writes run. Each is prepared on its write's transaction:
// one prepared on the connection would wait for the lock the transaction
// holds.
const find = 'SELECT status, holding_blockers FROM tasks WHERE id = ?';
const insertTask = `INSERT INTO tasks (id, title, kind, priority, parent_id, assignee, description, source_path, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '${Status.open}')`;
const insertChange =
  'INSERT INTO task_status_changes (task_id, from_status, to_status, changed_by, reason, time_changed) VALUES (?, ?, ?, ?, ?, ?)';
const insertExecution =
  'INSERT INTO task_executions (task_id, actor, log_path) VALUES (?, ?, ?)';
const setResult =
  'UPDATE task_executions SET result_path = ? WHERE task_id = ?';
const findLink =
  'SELECT 1 FROM task_links WHERE task_id = ? AND blocker_id = ?';
const insertLink = 'INSERT INTO task_links (task_id, blocker_id) VALUES (?, ?)';
const deleteLink =
  'DELETE FROM task_links WHERE task_id = ? AND blocker_id = ?';
// Whether the second task is reachable from the first through open blockers.
// A task past open has only succeeded or skipped blockers, so a path to an
// open task never runs through one.
const reaches = `WITH RECURSIVE reached (id) AS (
  SELECT ?
  UNION
  SELECT task_links.blocker_id FROM reached
  JOIN task_links ON task_links.task_id = reached.id
  JOIN tasks ON tasks.id = task_links.blocker_id AND tasks.status = '${Status.open}'
)
SELECT 1 FROM reached WHERE id = ? LIMIT 1`;
const addBlocker =
  'UPDATE tasks SET holding_blockers = holding_blockers + 1 WHERE id = ?';
const removeBlocker =
  'UPDATE tasks SET holding_blockers = holding_blockers - 1 WHERE id = ?';
const setStatus = 'UPDATE tasks SET status = ? WHERE id = ?';
const unblockDependents =
  'UPDATE tasks SET holding_blockers = holding_blockers - 1 WHERE id IN (SELECT task_id FROM task_links WHERE blocker_id = ?)';

// Thrown out of a write's transaction, so that a refusal rolls it back.
class Refusal {
  constructor(readonly result: unknown) {}
}

function refuse<R extends Reason>(reason: R): Refused<R> {
  return { ok: false, reason };
}

// A nullable text column as a string, or null.
function nullable(value: unknown) {
  return value === null ? null : String(value);
}

function toTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    title: String(row.title),
    kind: String(row.kind),
    priority: Number(row.priority),
    parentId: nullable(row.parent_id),
    assignee: String(row.assignee),
    description: nullable(row.description),
    sourcePath: nullable(row.source_path),
    // The table's check keeps it one of the five.
    status: String(row.status) as Status,
  };
}

// The graph's operations over a migrated connection. Readiness is kept in
// each task's holding_blockers, which every write moves in the same
// transaction, so no task past open is ever held by a blocker.
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

// Nothing logs yet: the first operation that does renames _logger.
export function createGraph(client: Database, _logger?: Logger): Graph {
  // Runs fn in an immediate transaction, which takes the write lock first, so
  // its checks and its writes see the same graph. Turso holds the connection
  // until the transaction ends: another operation waits for it. A refusal is
  // thrown out of the transaction, so only a success commits.
  async function write<T extends { ok: boolean }>(
    fn: (txn: Transaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await client
        .transactionAsync(async (txn) => {
          const result = await fn(txn);
          if (!result.ok) {
            throw new Refusal(result);
          }
          return result;
        })
        .immediate();
    } catch (error) {
      if (error instanceof Refusal) {
        return error.result as T;
      }
      throw error;
    }
  }

  // Records a change of a task's status, now, inside the caller's write.
  async function recordChange(
    txn: Transaction,
    id: string,
    from: Status | null,
    to: Status,
    changedBy: string,
    reason: string | null = null,
  ) {
    await txn.run(insertChange, id, from, to, changedBy, reason, Date.now());
  }

  return {
    createTask: async (input) => {
      const parsed = createTaskSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { parentId, createdBy, ...fields } = parsed.data;
      return write(async (txn) => {
        if (
          parentId !== undefined &&
          (await txn.get(find, parentId)) === undefined
        ) {
          return refuse(Reason.notFound);
        }
        const task: Task = {
          id: `tsk_${randomBytes(16).toString('hex')}`,
          ...fields,
          parentId: parentId ?? null,
          status: Status.open,
        };
        await txn.run(
          insertTask,
          task.id,
          task.title,
          task.kind,
          task.priority,
          task.parentId,
          task.assignee,
          task.description,
          task.sourcePath,
        );
        await recordChange(txn, task.id, null, Status.open, createdBy);
        return { ok: true, task };
      });
    },

    link: async (input) => {
      const parsed = linkSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { taskId, blockerId } = parsed.data;
      return write(async (txn) => {
        const task = await txn.get(find, taskId);
        const blocker = await txn.get(find, blockerId);
        if (task === undefined || blocker === undefined) {
          return refuse(Reason.notFound);
        }
        if (taskId === blockerId) {
          return refuse(Reason.sameTask);
        }
        if ((await txn.get(findLink, taskId, blockerId)) !== undefined) {
          return { ok: true };
        }
        if (task.status !== Status.open) {
          return refuse(Reason.notOpen);
        }
        // A blocker past open reaches no open task.
        if (
          blocker.status === Status.open &&
          (await txn.get(reaches, blockerId, taskId)) !== undefined
        ) {
          return refuse(Reason.cycle);
        }
        if (holds(blocker.status)) {
          await txn.run(addBlocker, taskId);
        }
        await txn.run(insertLink, taskId, blockerId);
        return { ok: true };
      });
    },

    unlink: async (input) => {
      const parsed = unlinkSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { taskId, blockerId } = parsed.data;
      return write(async (txn) => {
        const task = await txn.get(find, taskId);
        const blocker = await txn.get(find, blockerId);
        if (task === undefined || blocker === undefined) {
          return refuse(Reason.notFound);
        }
        if (task.status !== Status.open) {
          return refuse(Reason.notOpen);
        }
        const { changes } = await txn.run(deleteLink, taskId, blockerId);
        if (changes > 0 && holds(blocker.status)) {
          await txn.run(removeBlocker, taskId);
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
      return write(async (txn) => {
        const task = await txn.get(find, id);
        if (task === undefined) {
          return refuse(Reason.notFound);
        }
        if (task.status !== Status.open) {
          return refuse(Reason.notOpen);
        }
        if (Number(task.holding_blockers) > 0) {
          return refuse(Reason.blocked);
        }
        await txn.run(setStatus, Status.running, id);
        await recordChange(txn, id, Status.open, Status.running, changedBy);
        await txn.run(insertExecution, id, actor, logPath);
        return { ok: true };
      });
    },

    finishTask: async (input) => {
      const parsed = finishTaskSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { id, changedBy, status, reason, resultPath } = parsed.data;
      return write(async (txn) => {
        const task = await txn.get(find, id);
        if (task === undefined) {
          return refuse(Reason.notFound);
        }
        if (task.status !== Status.running) {
          return refuse(Reason.notRunning);
        }
        await txn.run(setStatus, status, id);
        await recordChange(txn, id, Status.running, status, changedBy, reason);
        // A running task has its execution, from its start.
        await txn.run(setResult, resultPath, id);
        // Every task it blocks is open: no task past open is held.
        if (!holds(status)) {
          await txn.run(unblockDependents, id);
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
      // The WHERE matches task_ready's, so Turso searches that index once per
      // assignee, then sorts only the rows it found. It scans the whole index
      // for assignees read from a JSON array, hence one parameter each.
      const rows = await client.all(
        `SELECT id, title, kind, priority, parent_id, assignee, description, source_path, status FROM tasks WHERE assignee IN (${assignees.map(() => '?').join(', ')}) AND status = '${Status.open}' AND holding_blockers = 0 ORDER BY priority, rowid LIMIT ?`,
        ...assignees,
        limit,
      );
      return { ok: true, tasks: rows.map(toTask) };
    },
  };
}
