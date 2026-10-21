import { randomBytes } from 'node:crypto';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { type FinalStatus, holds, isFinal, Status } from './status';

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
// nothing, and an error from SQLite or the file system is thrown. Each change
// of a task's status is recorded in that transaction, with when it happened
// and who made it: any name the caller uses, never checked.
export interface Graph {
  createTask: (
    task: NewTask,
  ) =>
    | { ok: true; task: Task }
    | Refused<typeof Reason.invalid | typeof Reason.notFound>;
  // Refuses a link that would close a cycle, or whose task isn't open. A pair
  // already linked succeeds and changes nothing.
  link: (
    link: Link,
  ) =>
    | { ok: true }
    | Refused<
        | typeof Reason.invalid
        | typeof Reason.notFound
        | typeof Reason.sameTask
        | typeof Reason.notOpen
        | typeof Reason.cycle
      >;
  // Refuses a task that isn't open. A pair not linked succeeds and changes
  // nothing.
  unlink: (
    link: Link,
  ) =>
    | { ok: true }
    | Refused<
        typeof Reason.invalid | typeof Reason.notFound | typeof Reason.notOpen
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
  }) =>
    | { ok: true }
    | Refused<
        | typeof Reason.invalid
        | typeof Reason.notFound
        | typeof Reason.notOpen
        | typeof Reason.blocked
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
  }) =>
    | { ok: true }
    | Refused<
        | typeof Reason.invalid
        | typeof Reason.notFound
        | typeof Reason.notRunning
      >;
  // The open tasks no blocker holds whose assignee is one of assignees,
  // matched exactly, most urgent first, then oldest, at most limit of them.
  listReady: (query: {
    assignees: string[];
    limit: number;
  }) => { ok: true; tasks: Task[] } | Refused<typeof Reason.invalid>;
}

function refuse<R extends Reason>(reason: R): Refused<R> {
  return { ok: false, reason };
}

function isId(value: unknown): value is string {
  return typeof value === 'string';
}

// A label with its spaces trimmed, or '' when it isn't a string.
function trimmed(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

// Text the caller may leave out, with its spaces trimmed: null when it is
// absent or blank, undefined when it isn't a string.
function optional(value: unknown) {
  if (value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  return value.trim() || null;
}

// A nullable text column as a string, or null.
function nullable(value: SQLOutputValue) {
  return value === null ? null : String(value);
}

function toTask(row: Record<string, SQLOutputValue>): Task {
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
export function createGraph(client: DatabaseSync): Graph {
  const find = client.prepare(
    'SELECT status, holding_blockers FROM tasks WHERE id = ?',
  );
  const insertTask = client.prepare(
    `INSERT INTO tasks (id, title, kind, priority, parent_id, assignee, description, source_path, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '${Status.open}')`,
  );
  const insertChange = client.prepare(
    'INSERT INTO task_status_changes (task_id, from_status, to_status, changed_by, reason, time_changed) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertExecution = client.prepare(
    'INSERT INTO task_executions (task_id, actor, log_path) VALUES (?, ?, ?)',
  );
  const setResult = client.prepare(
    'UPDATE task_executions SET result_path = ? WHERE task_id = ?',
  );
  const findLink = client.prepare(
    'SELECT 1 FROM task_links WHERE task_id = ? AND blocker_id = ?',
  );
  const insertLink = client.prepare(
    'INSERT INTO task_links (task_id, blocker_id) VALUES (?, ?)',
  );
  const deleteLink = client.prepare(
    'DELETE FROM task_links WHERE task_id = ? AND blocker_id = ?',
  );
  // Whether the second task is reachable from the first through open
  // blockers. A task past open has only succeeded or skipped blockers, so a
  // path to an open task never runs through one.
  const reaches = client.prepare(
    `WITH RECURSIVE reached (id) AS (
      SELECT ?
      UNION
      SELECT task_links.blocker_id FROM reached
      JOIN task_links ON task_links.task_id = reached.id
      JOIN tasks ON tasks.id = task_links.blocker_id AND tasks.status = '${Status.open}'
    )
    SELECT 1 FROM reached WHERE id = ? LIMIT 1`,
  );
  const addBlocker = client.prepare(
    'UPDATE tasks SET holding_blockers = holding_blockers + 1 WHERE id = ?',
  );
  const removeBlocker = client.prepare(
    'UPDATE tasks SET holding_blockers = holding_blockers - 1 WHERE id = ?',
  );
  const setStatus = client.prepare('UPDATE tasks SET status = ? WHERE id = ?');
  const unblockDependents = client.prepare(
    'UPDATE tasks SET holding_blockers = holding_blockers - 1 WHERE id IN (SELECT task_id FROM task_links WHERE blocker_id = ?)',
  );
  // The WHERE matches task_ready's, so SQLite searches that index once per
  // assignee in the JSON array, then sorts only the rows it found.
  const ready = client.prepare(
    `SELECT id, title, kind, priority, parent_id, assignee, description, source_path, status FROM tasks WHERE assignee IN (SELECT value FROM json_each(?)) AND status = '${Status.open}' AND holding_blockers = 0 ORDER BY priority, rowid LIMIT ?`,
  );

  // Runs fn in an immediate transaction, which takes the write lock first, so
  // its checks and its writes see the same graph. Commits only a success.
  function write<T extends { ok: boolean }>(fn: () => T): T {
    client.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      client.exec(result.ok ? 'COMMIT' : 'ROLLBACK');
      return result;
    } catch (error) {
      // SQLite rolls back by itself on some errors, a full disk among them.
      if (client.isTransaction) client.exec('ROLLBACK');
      throw error;
    }
  }

  // Records a change of a task's status, now, inside the caller's write.
  function recordChange(
    id: string,
    from: Status | null,
    to: Status,
    changedBy: string,
    reason: string | null = null,
  ) {
    insertChange.run(id, from, to, changedBy, reason, Date.now());
  }

  return {
    createTask: ({
      title,
      kind,
      priority,
      parentId,
      assignee,
      description,
      sourcePath,
      createdBy,
    }) => {
      const cleanTitle = trimmed(title);
      const cleanKind = trimmed(kind);
      const cleanAssignee = trimmed(assignee);
      const cleanDescription = optional(description);
      const cleanSourcePath = optional(sourcePath);
      const cleanCreatedBy = trimmed(createdBy);
      if (
        cleanTitle === '' ||
        cleanKind === '' ||
        !Number.isInteger(priority) ||
        priority < 0 ||
        priority > 4 ||
        (parentId !== undefined && !isId(parentId)) ||
        cleanAssignee === '' ||
        cleanDescription === undefined ||
        cleanSourcePath === undefined ||
        cleanCreatedBy === ''
      ) {
        return refuse(Reason.invalid);
      }
      return write(() => {
        if (parentId !== undefined && find.get(parentId) === undefined) {
          return refuse(Reason.notFound);
        }
        const task: Task = {
          id: `tsk_${randomBytes(16).toString('hex')}`,
          title: cleanTitle,
          kind: cleanKind,
          priority,
          parentId: parentId ?? null,
          assignee: cleanAssignee,
          description: cleanDescription,
          sourcePath: cleanSourcePath,
          status: Status.open,
        };
        insertTask.run(
          task.id,
          task.title,
          task.kind,
          task.priority,
          task.parentId,
          task.assignee,
          task.description,
          task.sourcePath,
        );
        recordChange(task.id, null, Status.open, cleanCreatedBy);
        return { ok: true, task };
      });
    },

    link: ({ taskId, blockerId }) => {
      if (!isId(taskId) || !isId(blockerId)) return refuse(Reason.invalid);
      return write(() => {
        const task = find.get(taskId);
        const blocker = find.get(blockerId);
        if (task === undefined || blocker === undefined) {
          return refuse(Reason.notFound);
        }
        if (taskId === blockerId) return refuse(Reason.sameTask);
        if (findLink.get(taskId, blockerId) !== undefined) return { ok: true };
        if (task.status !== Status.open) return refuse(Reason.notOpen);
        // A blocker past open reaches no open task.
        if (
          blocker.status === Status.open &&
          reaches.get(blockerId, taskId) !== undefined
        ) {
          return refuse(Reason.cycle);
        }
        if (holds(blocker.status)) addBlocker.run(taskId);
        insertLink.run(taskId, blockerId);
        return { ok: true };
      });
    },

    unlink: ({ taskId, blockerId }) => {
      if (!isId(taskId) || !isId(blockerId)) return refuse(Reason.invalid);
      return write(() => {
        const task = find.get(taskId);
        const blocker = find.get(blockerId);
        if (task === undefined || blocker === undefined) {
          return refuse(Reason.notFound);
        }
        if (task.status !== Status.open) return refuse(Reason.notOpen);
        const { changes } = deleteLink.run(taskId, blockerId);
        if (changes > 0 && holds(blocker.status)) removeBlocker.run(taskId);
        return { ok: true };
      });
    },

    startTask: ({ id, changedBy, actor, logPath }) => {
      const cleanChangedBy = trimmed(changedBy);
      const cleanActor = trimmed(actor);
      const cleanLogPath = optional(logPath);
      if (
        !isId(id) ||
        cleanChangedBy === '' ||
        cleanActor === '' ||
        cleanLogPath === undefined
      ) {
        return refuse(Reason.invalid);
      }
      return write(() => {
        const task = find.get(id);
        if (task === undefined) return refuse(Reason.notFound);
        if (task.status !== Status.open) return refuse(Reason.notOpen);
        if (Number(task.holding_blockers) > 0) return refuse(Reason.blocked);
        setStatus.run(Status.running, id);
        recordChange(id, Status.open, Status.running, cleanChangedBy);
        insertExecution.run(id, cleanActor, cleanLogPath);
        return { ok: true };
      });
    },

    finishTask: ({ id, changedBy, status, reason, resultPath }) => {
      const cleanChangedBy = trimmed(changedBy);
      const cleanReason = optional(reason);
      const cleanResultPath = optional(resultPath);
      if (
        !isId(id) ||
        cleanChangedBy === '' ||
        !isFinal(status) ||
        cleanReason === undefined ||
        cleanResultPath === undefined
      ) {
        return refuse(Reason.invalid);
      }
      return write(() => {
        const task = find.get(id);
        if (task === undefined) return refuse(Reason.notFound);
        if (task.status !== Status.running) return refuse(Reason.notRunning);
        setStatus.run(status, id);
        recordChange(id, Status.running, status, cleanChangedBy, cleanReason);
        // A running task has its execution, from its start.
        setResult.run(cleanResultPath, id);
        // Every task it blocks is open: no task past open is held.
        if (!holds(status)) unblockDependents.run(id);
        return { ok: true };
      });
    },

    // One statement reads one snapshot, so it takes no lock.
    listReady: ({ assignees, limit }) => {
      const names = Array.isArray(assignees) ? assignees.map(trimmed) : [];
      if (
        names.length === 0 ||
        names.includes('') ||
        !Number.isInteger(limit) ||
        limit < 1
      ) {
        return refuse(Reason.invalid);
      }
      return {
        ok: true,
        tasks: ready.all(JSON.stringify(names), limit).map(toTask),
      };
    },
  };
}
