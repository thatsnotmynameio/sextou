---
title: Where Turso behaves differently from SQLite
date: 2026-10-21
category: best-practices
module: apps/server, packages/tasks
problem_type: best_practice
component: database
severity: high
applies_when:
  - Writing a transaction against either database, through Turso's client or through drizzle
  - Adding the server database's first table, or a schema step to packages/tasks
  - Porting SQL, a pragma or a test written for node:sqlite or SQLite's documentation
  - Writing a test that needs a database in an unusual state
retire_when: 'A @tursodatabase/database release past 0.8.3 changes one of these behaviors: rerun the probes below on the new version before trusting this doc'
tags:
  [turso, sqlite, transaction, drizzle, foreign-keys, migration, wal, deadlock]
---

# Where Turso behaves differently from SQLite

## Context

PR #47 moved both databases from `node:sqlite` to Turso (`@tursodatabase/database` 0.8.3, pinned today in `apps/server/package.json:23` and `packages/tasks/package.json:18`). Turso reads and writes SQLite's file format, so it is easy to assume it behaves like SQLite. Several of its behaviors differ, and most of the differences fail silently: a hang, a check that passes, a transaction that isn't one. Each one below was found by probing Turso 0.8.3 on Node 26 during that port, not from Turso's documentation.

## Guidance

1. **Inside a transaction, run every query on its `tx`, never on `db`.** drizzle's `db.transaction()` runs on Turso's `transactionAsync`, which holds the connection until it commits or rolls back. A query on `db` inside the callback, or one prepared on `db` before it, waits for that lock, which is released only when the callback returns, so the call hangs with no error. The same holds for `txn` and `client` when calling `transactionAsync` directly. The task graph follows this rule and says so where it applies (`packages/tasks/src/graph.ts:163-164`).

2. **Use drizzle 1.0.0-rc.5 or later for `db.transaction()`.** On rc.4, drizzle's Turso session called Turso's deprecated `transaction()`, which in Turso's words "only emits `BEGIN`/`COMMIT` around the callback without owning the connection, so concurrent statements and transactions can interleave their own statements into the transaction's window (and be committed or rolled back with it)" (`node_modules/@tursodatabase/database-common/dist/promise.d.ts:134-138`). rc.5 calls `transactionAsync` instead and applies `behavior` (`node_modules/drizzle-orm/tursodatabase/session.js:55-61`), so `db.transaction(fn, { behavior: 'immediate' })` holds the connection for the whole transaction. The task graph runs every write so, and a test that starts one task twice at once proves the writes serialize (issue #59). A query's error inside it rejects as drizzle's `DrizzleQueryError`, with Turso's on `cause`.

3. **A rollback can hide the error that caused it.** `transactionAsync` runs `await txn.exec("ROLLBACK")` in its `catch`, with no guard (installed package, `node_modules/@tursodatabase/database-common/dist/promise.js:320-322`). If that `ROLLBACK` throws, its error replaces the original one. When an error from inside a transaction makes no sense, suspect this before the code that threw.

4. **`PRAGMA foreign_keys` takes effect inside a transaction, and `PRAGMA foreign_key_check` finds nothing.** SQLite ignores `foreign_keys` inside a transaction; Turso applies it. drizzle-kit wraps a table rebuild in `PRAGMA foreign_keys=OFF` and `=ON`, so on Turso the rebuild really runs with foreign keys off: dropping a referenced table leaves the rows that referenced it in place. `foreign_key_check` would be the usual way to catch those rows, but in 0.8.3 it reports nothing even when they exist. Nothing checks for orphaned rows around a migration yet: no migration so far rebuilds a table. The first one that rebuilds a referenced table should look for orphaned rows itself before it commits.

5. **Foreign keys start off and `synchronous` starts at FULL.** The task graph turns foreign keys on when it opens (`packages/tasks/src/open-tasks.ts:35`). The server's database has no table yet and leaves them off: its first table brings the pragma. Code that relies on a cascade or a refused orphan without that pragma gets neither.

6. **`WITHOUT ROWID` is an experiment.** Turso 0.8.3 takes no `DELETE`, `UPDATE`, foreign key or second index on such a table, so the task graph's tables are rowid tables (`packages/tasks/src/schema.ts:21-23`).

7. **Bind an `IN` list one parameter per value.** `assignee IN (SELECT value FROM json_each(?))` makes Turso scan the whole `task_ready` index. A bound `IN (?, ?, …)` makes it search the index once per value through drizzle's `inArray` (`packages/tasks/src/graph.ts:451-460`). The port's plan measured about 0.5 ms against 60 to 84 ms at 50,000 tasks. A test checks the query plan, so a change back to `json_each` fails it.

8. **A second process is refused, not made to wait.** Opening a file another process holds fails with "File is locked by another process". There is no busy timeout to set. The server connects on its first query, so a second server on the same database file still starts, and its health reports the database down while the first one's stays up.

9. **The WAL sidecar outlives the connection and keeps the mode it was created with.** Turso writes only `<file>-wal` and keeps it after close. It creates a missing sidecar with the umask's mode, so `restrictToOwner` creates it at 0600 before Turso opens the file (`packages/tasks/src/owner-only.ts:8-14`).

10. **Turso's errors don't read like SQLite's.** A file that isn't a database fails with `failed to open database <path>: File is not a database`. An assertion copied from a `node:sqlite` test with its message won't match.

## Why This Matters

Items 1, 2 and 4 leave no error where the mistake is made. A write that deadlocks only hangs. On rc.4, a drizzle transaction was atomic in a single-caller test and interleaved only under concurrent requests. A rebuild that orphans rows passes its migration test, and `foreign_key_check` agrees that nothing is wrong. Each would surface later, as a hung server, a write that half-committed, or a row that points nowhere.

## When to Apply

- Before writing any transaction against either database, or a migration that rebuilds a table.
- Before trusting SQLite's documentation, or a `node:sqlite` habit, about a pragma, an index plan or an error message.
- On a Turso upgrade: rerun the probes for these items and update this doc.

## Examples

How to probe a behavior before relying on it: a throwaway script outside the repo, run with the repo's Turso.

```js
import { connect } from '@tursodatabase/database';

const client = await connect(':memory:');
await client.exec(
  'PRAGMA foreign_keys = ON; CREATE TABLE p (id INTEGER PRIMARY KEY); CREATE TABLE c (p REFERENCES p (id)); INSERT INTO p VALUES (1); INSERT INTO c VALUES (1)',
);
await client
  .transactionAsync(async (txn) => {
    await txn.exec('PRAGMA foreign_keys = OFF; DROP TABLE p');
  })
  .immediate();
console.log(await client.get('PRAGMA foreign_keys')); // 0: the pragma held
console.log(await client.all('PRAGMA foreign_key_check')); // []: the orphan in c goes unreported
```

A write in the task graph, with every query on the transaction:

```ts
await db.transaction(
  async (tx) => {
    // never db.update(...) here
    await tx
      .update(tasks)
      .set({ status: Status.running })
      .where(eq(tasks.id, id));
  },
  { behavior: 'immediate' },
);
```

Tests follow the same rule as the code: they reach a database only through Turso. The one exception is the test that opens a file Turso wrote with `node:sqlite` (`packages/tasks/tests/integration/open-tasks.test.ts`), because what it proves is that standard SQLite can still read sextou's files.

## Related

- Plan for the port: `.compound-engineering/artifacts/plans/2026-10-21-0140-refactor-turso-database-plan.md`
- PR #47, which moved both databases to Turso.
- `.compound-engineering/artifacts/explainers/2026-10-20-json-each-in-list.md`, written before the port, about `json_each` in an `IN` list.
