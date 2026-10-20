import { randomBytes } from 'node:crypto';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

// Why an operation changed nothing.
export type Reason =
  | 'invalid'
  | 'not_found'
  | 'same_task'
  | 'not_open'
  | 'cycle'
  | 'open_blockers';

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
  // A closed task never reopens.
  status: 'open' | 'closed';
  // Milliseconds since the epoch.
  timeCreated: number;
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
}

// The task is blocked by the blocker.
export interface Link {
  taskId: string;
  blockerId: string;
}

// Every operation that writes runs in one transaction: a refusal writes
// nothing, and an error from SQLite or the file system is thrown.
export interface Graph {
  createTask: (
    task: NewTask,
  ) => { ok: true; task: Task } | Refused<'invalid' | 'not_found'>;
  // Refuses a link that would close a cycle, or whose task is closed. A pair
  // already linked succeeds and changes nothing.
  link: (
    link: Link,
  ) =>
    | { ok: true }
    | Refused<'invalid' | 'not_found' | 'same_task' | 'not_open' | 'cycle'>;
  // Refuses a closed task. A pair not linked succeeds and changes nothing.
  unlink: (
    link: Link,
  ) => { ok: true } | Refused<'invalid' | 'not_found' | 'not_open'>;
  // Refuses a task with an open blocker. A closed task succeeds and changes
  // nothing.
  closeTask: (
    id: string,
  ) => { ok: true } | Refused<'invalid' | 'not_found' | 'open_blockers'>;
  // The open tasks with no open blocker whose assignee is one of assignees,
  // matched exactly, most urgent first, then oldest, at most limit of them.
  listReady: (query: {
    assignees: string[];
    limit: number;
  }) => { ok: true; tasks: Task[] } | Refused<'invalid'>;
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

function toTask(row: Record<string, SQLOutputValue>): Task {
  return {
    id: String(row.id),
    title: String(row.title),
    kind: String(row.kind),
    priority: Number(row.priority),
    parentId: row.parent_id === null ? null : String(row.parent_id),
    assignee: String(row.assignee),
    description: row.description === null ? null : String(row.description),
    sourcePath: row.source_path === null ? null : String(row.source_path),
    status: row.status === 'closed' ? 'closed' : 'open',
    timeCreated: Number(row.time_created),
  };
}

// The graph's operations over a migrated connection. Readiness is kept in
// each task's open_blockers, which every write moves in the same transaction,
// so no closed task ever has an open blocker.
export function createGraph(client: DatabaseSync): Graph {
  const find = client.prepare(
    'SELECT status, open_blockers FROM task WHERE id = ?',
  );
  const insertTask = client.prepare(
    "INSERT INTO task (id, title, kind, priority, parent_id, assignee, description, source_path, status, time_created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)",
  );
  const findLink = client.prepare(
    'SELECT 1 FROM link WHERE task_id = ? AND blocker_id = ?',
  );
  const insertLink = client.prepare(
    'INSERT INTO link (task_id, blocker_id) VALUES (?, ?)',
  );
  const deleteLink = client.prepare(
    'DELETE FROM link WHERE task_id = ? AND blocker_id = ?',
  );
  // Whether the second task is reachable from the first through open
  // blockers. A closed task's blockers are all closed, so a path to an open
  // task never runs through closed history.
  const reaches = client.prepare(
    `WITH RECURSIVE reached (id) AS (
      SELECT ?
      UNION
      SELECT link.blocker_id FROM reached
      JOIN link ON link.task_id = reached.id
      JOIN task ON task.id = link.blocker_id AND task.status = 'open'
    )
    SELECT 1 FROM reached WHERE id = ? LIMIT 1`,
  );
  const addBlocker = client.prepare(
    'UPDATE task SET open_blockers = open_blockers + 1 WHERE id = ?',
  );
  const removeBlocker = client.prepare(
    'UPDATE task SET open_blockers = open_blockers - 1 WHERE id = ?',
  );
  const markClosed = client.prepare(
    "UPDATE task SET status = 'closed' WHERE id = ?",
  );
  const unblockDependents = client.prepare(
    'UPDATE task SET open_blockers = open_blockers - 1 WHERE id IN (SELECT task_id FROM link WHERE blocker_id = ?)',
  );
  // The WHERE matches task_ready's, so SQLite searches that index once per
  // assignee in the JSON array, then sorts only the rows it found.
  const ready = client.prepare(
    "SELECT id, title, kind, priority, parent_id, assignee, description, source_path, status, time_created FROM task WHERE assignee IN (SELECT value FROM json_each(?)) AND status = 'open' AND open_blockers = 0 ORDER BY priority, rowid LIMIT ?",
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

  return {
    createTask: ({
      title,
      kind,
      priority,
      parentId,
      assignee,
      description,
      sourcePath,
    }) => {
      const cleanTitle = trimmed(title);
      const cleanKind = trimmed(kind);
      const cleanAssignee = trimmed(assignee);
      const cleanDescription = optional(description);
      const cleanSourcePath = optional(sourcePath);
      if (
        cleanTitle === '' ||
        cleanKind === '' ||
        !Number.isInteger(priority) ||
        priority < 0 ||
        priority > 4 ||
        (parentId !== undefined && !isId(parentId)) ||
        cleanAssignee === '' ||
        cleanDescription === undefined ||
        cleanSourcePath === undefined
      ) {
        return refuse('invalid');
      }
      return write(() => {
        if (parentId !== undefined && find.get(parentId) === undefined) {
          return refuse('not_found');
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
          status: 'open',
          timeCreated: Date.now(),
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
          task.timeCreated,
        );
        return { ok: true, task };
      });
    },

    link: ({ taskId, blockerId }) => {
      if (!isId(taskId) || !isId(blockerId)) return refuse('invalid');
      return write(() => {
        const task = find.get(taskId);
        const blocker = find.get(blockerId);
        if (task === undefined || blocker === undefined) {
          return refuse('not_found');
        }
        if (taskId === blockerId) return refuse('same_task');
        if (findLink.get(taskId, blockerId) !== undefined) return { ok: true };
        if (task.status !== 'open') return refuse('not_open');
        // A closed blocker reaches no open task and keeps no task waiting.
        if (blocker.status === 'open') {
          if (reaches.get(blockerId, taskId) !== undefined) {
            return refuse('cycle');
          }
          addBlocker.run(taskId);
        }
        insertLink.run(taskId, blockerId);
        return { ok: true };
      });
    },

    unlink: ({ taskId, blockerId }) => {
      if (!isId(taskId) || !isId(blockerId)) return refuse('invalid');
      return write(() => {
        const task = find.get(taskId);
        const blocker = find.get(blockerId);
        if (task === undefined || blocker === undefined) {
          return refuse('not_found');
        }
        if (task.status !== 'open') return refuse('not_open');
        const { changes } = deleteLink.run(taskId, blockerId);
        if (changes > 0 && blocker.status === 'open') removeBlocker.run(taskId);
        return { ok: true };
      });
    },

    closeTask: (id) => {
      if (!isId(id)) return refuse('invalid');
      return write(() => {
        const task = find.get(id);
        if (task === undefined) return refuse('not_found');
        if (task.status === 'closed') return { ok: true };
        if (Number(task.open_blockers) > 0) return refuse('open_blockers');
        markClosed.run(id);
        // Every task it blocks is open: a closed one has no open blocker.
        unblockDependents.run(id);
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
        return refuse('invalid');
      }
      return {
        ok: true,
        tasks: ready.all(JSON.stringify(names), limit).map(toTask),
      };
    },
  };
}
