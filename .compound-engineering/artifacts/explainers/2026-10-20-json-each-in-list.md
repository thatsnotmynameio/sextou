---
title: A list of any length through one bound parameter
date: 2026-10-20
input_shape: concept
subject: '@sextou/tasks, how the ready list matches several assignees with one prepared statement'
---

# A list of any length through one bound parameter

## What it is

SQLite binds one value per `?`, so `assignee IN (?, ?, ?)` fixes the length of the list when the statement is prepared. Instead, the caller's list goes in as one JSON array, and SQLite's `json_each` table-valued function turns it back into rows inside the query:

```sql
SELECT ... FROM task
WHERE assignee IN (SELECT value FROM json_each(?))
  AND status = 'open' AND open_blockers = 0
ORDER BY priority, rowid LIMIT ?
```

The code binds `JSON.stringify(names)`. One statement, prepared once when the graph opens, serves a list of one assignee or of fifty.

## Why here, rather than the obvious alternative

The obvious alternative builds the SQL on each call with as many `?` as the list has entries. That means preparing a statement per call, or caching one per length, and it spreads string assembly into code that otherwise prepares every statement up front. `json_each` keeps the graph's rule that every statement is prepared at creation.

SQLite still uses the index. With `task_ready` on `(assignee, priority)` and the same partial `WHERE`, the plan is:

```
SEARCH task USING INDEX task_ready (assignee=?)
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
USE TEMP B-TREE FOR ORDER BY
```

SQLite runs one index search per assignee in the array, then sorts only the rows it found. The sort's cost grows with the requested assignees' ready tasks, never with closed tasks or other assignees' work. At 50k tasks, a call with three assignees took about 0.1 ms. The plan did not change after `ANALYZE`.

## An example from this change

In `packages/tasks/src/graph.ts`, `listReady` trims each entry, refuses an empty list or a blank entry as `invalid`, and runs the prepared statement:

```ts
ready.all(JSON.stringify(names), limit);
```

Asking for `['bot-dev-1', 'dev']` returns both assignees' ready tasks in one list, most urgent first, then oldest. A duplicate entry is harmless, because `IN` matches each row once.

## When not to use it

The list must hold plain values JSON can carry: strings and numbers. Binary values do not round-trip. When the list always has one entry, a plain `= ?` reads the index in order and needs no sort. When the list is huge and the result is unbounded, the per-entry index searches and the sort add up, so a temporary table with a join is the better tool. `json_each` needs SQLite 3.38 or later, where the JSON functions are built in.
