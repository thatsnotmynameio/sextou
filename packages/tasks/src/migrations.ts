import type { Database } from '@tursodatabase/database';
import { Status, statusList } from './status';

// The schema, one step per release that changed it. A database records how
// many steps it has in user_version. Never edit or remove a merged step: a
// database that already applied it never runs the edit.
export const steps = [
  // holding_blockers counts the task's blockers that still hold it: those
  // open, running or failed. A ready task is then one row of task_ready, which
  // no other index covers: with a second candidate, SQLite can pick the wrong
  // one. The index orders by assignee, then by priority, then by rowid, which
  // is the order the tasks were created in. task_link_blocker finds the tasks
  // a finishing task blocks.
  //
  // task_status_changes records each change of a task's status, its creation
  // first; its own key keeps changes in the same millisecond in order.
  // task_executions records who runs a started task and where its log and
  // result are; its start and end are the changes into and out of running.
  // Nothing reads either yet, so neither has an index beyond its key.
  //
  // task_links and task_executions are rowid tables: Turso has WITHOUT ROWID
  // only as an experiment, with no DELETE, UPDATE, foreign key or second
  // index.
  `CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 4),
    parent_id TEXT REFERENCES tasks (id),
    assignee TEXT NOT NULL,
    description TEXT,
    source_path TEXT,
    status TEXT NOT NULL
      CHECK (status IN (${statusList})),
    holding_blockers INTEGER NOT NULL DEFAULT 0 CHECK (holding_blockers >= 0)
  );
  CREATE INDEX task_ready ON tasks (assignee, priority)
    WHERE status = '${Status.open}' AND holding_blockers = 0;
  CREATE TABLE task_links (
    task_id TEXT NOT NULL REFERENCES tasks (id),
    blocker_id TEXT NOT NULL REFERENCES tasks (id),
    PRIMARY KEY (task_id, blocker_id)
  );
  CREATE INDEX task_link_blocker ON task_links (blocker_id);
  CREATE TABLE task_status_changes (
    id INTEGER PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks (id),
    from_status TEXT
      CHECK (from_status IN (${statusList})),
    to_status TEXT NOT NULL
      CHECK (to_status IN (${statusList})),
    changed_by TEXT NOT NULL,
    reason TEXT,
    time_changed INTEGER NOT NULL
  );
  CREATE TABLE task_executions (
    task_id TEXT PRIMARY KEY REFERENCES tasks (id),
    actor TEXT NOT NULL,
    log_path TEXT,
    result_path TEXT
  );`,
];

// Applies the steps the database lacks, in order, in one transaction. Throws,
// with the database left as it was, when one fails or when the database has
// more steps than this version ships, because a newer version wrote it.
export async function migrate(client: Database, shipped: string[] = steps) {
  // Turso rolls the transaction back when the callback throws.
  await client
    .transactionAsync(async (txn) => {
      const version = Number(
        (await txn.get('PRAGMA user_version'))?.user_version,
      );
      if (version > shipped.length) {
        throw new Error(
          `This tasks database was written by a newer version (schema ${version}, this one knows ${shipped.length})`,
        );
      }
      for (let step = version; step < shipped.length; step++) {
        try {
          await txn.exec(shipped[step]);
        } catch (error) {
          throw new Error(
            `Tasks migration ${step + 1} failed: ${(error as Error).message}`,
            { cause: error },
          );
        }
      }
      // A pragma takes no bound parameter; the count is a number.
      await txn.exec(`PRAGMA user_version = ${shipped.length}`);
    })
    .immediate();
}
