---
name: run-tasks
description: Run, call, smoke-test and inspect the task graph library (@sextou/tasks, packages/tasks) without the server. Use when asked to try a tasks operation by hand (createTask, link, claimTask, renewExecution, finishTask, cancelTask, assignTask, expireExecutions, listReady), let a lease expire with a fake clock, read the rows a call wrote (task_status_changes, task_executions), check that a tasks change works, or run its tests.
---

`@sextou/tasks` is a library: no process to start. An agent drives it with `.claude/skills/run-tasks/driver.mjs`, which imports the package through its public export (`@sextou/tasks`), runs one operation per call on a database file that persists between calls, and lets the caller set the clock. It also runs a smoke flow in memory and reads any table with SQL.

All paths below are relative to `packages/tasks/`. Run `pnpm` commands from the repository root.

## Setup

```bash
pnpm install          # from the repository root
```

The package ships TypeScript sources, so every driver command runs under tsx (`node --import tsx`), which the root install provides.

## Run (agent path)

```bash
node --import tsx .claude/skills/run-tasks/driver.mjs smoke    # a task's whole life, in memory; exits 1 at the first wrong step
node --import tsx .claude/skills/run-tasks/driver.mjs call createTask '{"title":"Lease","kind":"task","priority":1,"assignee":"dev","createdBy":"me"}'
node --import tsx .claude/skills/run-tasks/driver.mjs call createTask '{"title":"Checkout","kind":"task","priority":1,"assignee":"dev","createdBy":"me","context":{"repo":"org/app","sha":"abc"}}'
node --import tsx .claude/skills/run-tasks/driver.mjs call listReady '{"assignees":["dev"],"limit":5}'
node --import tsx .claude/skills/run-tasks/driver.mjs query "select title, context ->> '\$.repo' as repo from tasks"
node --import tsx .claude/skills/run-tasks/driver.mjs query 'select task_id, from_status, to_status, changed_by, reason, time_changed from task_status_changes order by id'
node --import tsx .claude/skills/run-tasks/driver.mjs reset    # deletes the database file
```

| command                   | what it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `call <operation> [json]` | Opens the graph with `openTasks` (applying any migration the file lacks), calls the operation with the JSON as its one argument, prints the result and closes. Exits 1 on a refusal (`{ "ok": false, "reason": … }`), 2 on an unknown operation, which lists the real ones.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `query <sql>`             | Runs the SQL on the file with Turso directly and prints the rows. For what no operation returns: `task_status_changes`, `task_executions` (lease, `claim_id`, cancel request), `tasks.holding_blockers`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `smoke`                   | In memory with a fake clock: create with a context and a `uses` and without either, a context that is not an object and a `uses` whose ref is a branch refused, link, a refused cycle, the ready list, claim, the context and the `uses` handed out with the claim, the claim resent, renew, expiry into attempt 2, a stale renew and finish refused as `lease_lost`, cancel requested and seen by renew, finish and its resend, `already_finished`, then the blocked task freed and claimed with a null `uses`. Then a finish with a file of two tasks, `second` waiting for `first`, while another task waits for the finished one: its answer names both by key, the same finish resent gets the same ids, and only `first` is ready, as the finished task's child, with `second` waiting for it and the other task for `second`. Last, a file whose task carries `blocked_by` fails its task with the reason `tasks file: task "second" has the unknown field "blocked_by"` and creates nothing. Touches no file. |
| `reset`                   | Deletes the database file and its `-wal`/`-shm`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Two variables, read on every command:

- `RUN_TASKS_DB`: the database file, `/tmp/sextou-run-tasks/tasks.db` by default.
- `RUN_TASKS_NOW`: the clock in milliseconds since the epoch, which `openTasks` gets as `now`: every recorded time, lease and expiry reads it. `Date.now()` when unset.

Moving the clock lets a lease expire without waiting. This run fails the task with `lease expired` (verified):

```bash
node --import tsx .claude/skills/run-tasks/driver.mjs reset
RUN_TASKS_NOW=1700000000000 node --import tsx .claude/skills/run-tasks/driver.mjs call createTask '{"title":"Lease","kind":"task","priority":1,"assignee":"dev","createdBy":"me"}'
RUN_TASKS_NOW=1700000000000 node --import tsx .claude/skills/run-tasks/driver.mjs call claimTask '{"claimId":"c1","assignees":["dev"],"actor":"r1","leaseMs":1000}'
RUN_TASKS_NOW=1700000005000 node --import tsx .claude/skills/run-tasks/driver.mjs call expireExecutions '{"maxAttempts":1,"changedBy":"sweep"}'   # expired: [{ …, "status": "failed" }]
node --import tsx .claude/skills/run-tasks/driver.mjs query 'select id, attempt, expires_at from task_executions'   # expires_at: null once ended
```

To read what a server run wrote, stop the server first, then point `RUN_TASKS_DB` at its `tasks.db` (the `dataDir` that `apps/server`'s run-server driver prints on `start`):

```bash
RUN_TASKS_DB=/tmp/sextou-server-data-XXXXXX/tasks.db node --import tsx .claude/skills/run-tasks/driver.mjs query 'select title, status from tasks'
```

## Test

```bash
pnpm --filter @sextou/tasks test:unit          # schemas and statuses
pnpm --filter @sextou/tasks test:integration   # the graph on real files and ':memory:'
pnpm --filter @sextou/tasks test:mutation      # Stryker, fails below 80%
pnpm exec vitest run --project 'tasks/*' graph # one module, no coverage verdict
```

## Gotchas

- **Plain `node` loads the TypeScript but can't resolve it.** Node strips the types itself, then fails on the package's extensionless imports (`Cannot find module '…/src/graph' imported from …/src/index.ts`). Always run the driver with `--import tsx`.
- **The driver imports `@sextou/tasks` by name, which resolves only inside the package.** Node's self-reference through `package.json`'s `exports` finds it; there is no `node_modules/@sextou/tasks` (the workspace hoists, `nodeLinker: hoisted`). Copying the driver out of `packages/tasks/` breaks that import. It runs from any working directory.
- **Turso refuses a second process on the same file.** Any process with the file open, a running server included, makes the driver's open fail with `File is locked by another process`. Stop the server before pointing `RUN_TASKS_DB` at its file.
- **`finishTask` takes a file of tasks only with both limits.** A `call finishTask` whose JSON carries `tasks`, the file's text as a string (`"{\"tasks\":[…]}"`), needs `maxTasks` and `maxDepth` too, or it is refused as `invalid`. A file the graph can't take is not a refusal: the answer is `ok`, with `status: failed` and the reason, and nothing created.
- **A refusal is a result, not an error.** `call` prints `{ "ok": false, "reason": "invalid" }` for any input the operation's zod schema rejects, an empty `assignees`, a missing argument, a `context` that is not an object or nests more than 500 levels deep, or a `uses` whose ref is not a full commit SHA (`owner/name/path/to/Taskfile.yml@<40 hex>`) included, and exits 1.
- **`RUN_TASKS_NOW` is fixed for the whole call.** Every time the call records is that same instant, so two calls under one value tie on `time_changed`. Order by `id` instead.
- **`query` returns `context` as JSON text.** drizzle turns it into an object for the operations; Turso hands `query` the stored string. Read a key with `context ->> '$.repo'`.
- **Column names differ from the API's.** `task_status_changes` has `from_status`, `to_status` and `time_changed`, not `status`. `query "select name, sql from sqlite_schema where type='table'"` lists every table's columns.
- **Lint scans this folder.** `lint / gates` refuses `console` outside test files, so the driver writes through `process.stdout`/`process.stderr`. Run `pnpm exec oxlint -c .oxlintrc.gates.json .` and `pnpm exec oxfmt --check .` after editing it.

## Troubleshooting

- **`Cannot find module '…/packages/tasks/src/graph'`**: the driver ran without `--import tsx`. Add it.
- **`failed to open database …: Locking error: … File is locked by another process`**: another process, such as a server, has the file open. Stop it, or set `RUN_TASKS_DB` to another path.
- **`prepare failed: Parse error: no such column: …`**: a `query` named a column the table lacks. List the columns from `sqlite_schema`.
- **`RUN_TASKS_NOW must be milliseconds since the epoch`**: the clock is not a whole number. Use something like `1700000000000`.
