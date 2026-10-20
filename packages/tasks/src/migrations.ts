import type { DatabaseSync } from 'node:sqlite';

// The schema, one step per release that changed it. A database records how
// many steps it has in user_version. Never edit or remove a merged step: a
// database that already applied it never runs the edit.
export const steps = [
  // open_blockers counts the task's blockers that are still open, so a ready
  // task is one row of task_ready, which no other index covers: with a second
  // candidate, SQLite can pick the wrong one. The index orders by priority,
  // then by rowid, which is the order the tasks were created in.
  // link_blocker finds the tasks a closing task blocks.
  `CREATE TABLE task (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 4),
    parent_id TEXT REFERENCES task (id),
    status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
    open_blockers INTEGER NOT NULL DEFAULT 0 CHECK (open_blockers >= 0),
    time_created INTEGER NOT NULL
  );
  CREATE INDEX task_ready ON task (priority)
    WHERE status = 'open' AND open_blockers = 0;
  CREATE TABLE link (
    task_id TEXT NOT NULL REFERENCES task (id),
    blocker_id TEXT NOT NULL REFERENCES task (id),
    PRIMARY KEY (task_id, blocker_id)
  ) WITHOUT ROWID;
  CREATE INDEX link_blocker ON link (blocker_id);`,
];

// Applies the steps the database lacks, in order, in one transaction. Throws,
// with the database left as it was, when one fails or when the database has
// more steps than this version ships, because a newer version wrote it.
export function migrate(client: DatabaseSync, shipped: string[] = steps) {
  client.exec('BEGIN IMMEDIATE');
  try {
    const version = Number(
      client.prepare('PRAGMA user_version').get()?.user_version,
    );
    if (version > shipped.length) {
      throw new Error(
        `This tasks database was written by a newer version (schema ${version}, this one knows ${shipped.length})`,
      );
    }
    for (let step = version; step < shipped.length; step++) {
      try {
        client.exec(shipped[step]);
      } catch (error) {
        throw new Error(
          `Tasks migration ${step + 1} failed: ${(error as Error).message}`,
          { cause: error },
        );
      }
    }
    // A pragma takes no bound parameter; the count is a number.
    client.exec(`PRAGMA user_version = ${shipped.length}`);
    client.exec('COMMIT');
  } catch (error) {
    client.exec('ROLLBACK');
    throw error;
  }
}
