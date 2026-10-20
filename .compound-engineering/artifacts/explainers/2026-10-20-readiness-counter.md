---
title: A readiness counter read through a partial index
date: 2026-10-20
input_shape: concept
subject: '@sextou/tasks, how the ready list stays fast as closed tasks pile up'
---

# A readiness counter read through a partial index

## What it is

A task is ready when it is open and none of its blockers is open. Instead of working that out at read time, each task row stores `open_blockers`, the number of its blockers that are still open. Every write that changes the answer moves the counter in the same transaction: linking to an open blocker adds one, unlinking an open blocker subtracts one, and closing a task subtracts one from every task it blocked. A partial index holds only the rows that are ready right now, ordered by priority and then by creation order:

```sql
CREATE INDEX task_ready ON task (priority)
  WHERE status = 'open' AND open_blockers = 0;
```

The ready list is then a read of the first rows of that index, with no join and no sort.

## Why here, rather than the obvious alternative

The obvious alternative derives readiness on each read, with `NOT EXISTS` over the links of every open task. Its cost grows with the number of open tasks and their links. The 2026-10-20 benchmark on `node:sqlite` measured the counter at p50 0.20 to 0.25 ms from 10k to 50k tasks, while the derived query slowed as open tasks grew. Closed tasks never enter the index, so a graph that keeps its whole history reads its ready list as fast as a new one.

The counter can drift if a write path forgets it. Three things guard against that: `CHECK (open_blockers >= 0)` refuses a write that would go below zero, every change is judged by whether its row change happened (an insert that added a link, a delete that removed one), and a property test runs a few hundred random operations and compares each counter with a count of open blockers.

The benchmark also found that with two candidate indexes for the same query, SQLite could pick the wrong one. So `task_ready` is the only index that covers the ready query, and a test reads the query plan to check that SQLite uses it.

## An example from this change

In `packages/tasks/src/graph.ts`, `closeTask` marks the task closed and runs one statement for its dependents:

```sql
UPDATE task SET open_blockers = open_blockers - 1
WHERE id IN (SELECT task_id FROM link WHERE blocker_id = ?)
```

A dependent whose counter reaches 0 enters `task_ready` in the same write, so the next `listReady` sees it. The `link_blocker` index serves the subquery, so a close never scans the whole link table.

## When not to use it

A counter is worth it when reads far outnumber writes and the derived query grows with history. With a few hundred rows, or when the readiness rule changes often, deriving it on read is simpler and cannot drift. Use it only when every write to the inputs goes through code that moves the counter. A second writer that edits the tables directly would break it.
