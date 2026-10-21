---
title: Turso Database Engine - Plan
type: refactor
date: 2026-10-21
topic: turso-database
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Turso Database Engine - Plan

## Goal Capsule

- **Objective:** sextou's two databases, `sextou.db` and the default organization's task graph, run on Turso, so later work can turn on Turso's native features (concurrent writes, encryption at rest, sync, CDC) without another engine change. Everything the server and the task graph do today keeps working the same way.
- **Means:** `@sextou/data` and `@sextou/tasks` open their files through Turso's embedded library (`@tursodatabase/database`) in WAL mode instead of `node:sqlite`, and the server's build ships that library beside its bundle.
- **Product authority:** the repository owner. Only the engine swap is in scope. MVCC, encryption, sync, CDC and asynchronous I/O are later work and not active scope here.
- **Open blockers:** none.

---

## Product Contract

### Summary

Both databases open through Turso in WAL mode, with the same schema, migrations, rules and refusals they have today. The files stay standard SQLite files. The server runs from its bundle plus Turso's installed package for the platform.

### Problem Frame

Both of sextou's databases use the SQLite built into Node: `@sextou/data` through drizzle's `node-sqlite` driver (`packages/data/src/database.ts`), and `@sextou/tasks` through raw SQL on `DatabaseSync` (`packages/tasks/src/open-tasks.ts`). That SQLite offers one writer at a time and none of the features the owner wants sextou to grow into: concurrent writes, encryption at rest, sync with another copy, and a change feed.

Turso, the Rust rewrite of SQLite, ships those as native features. `node:sqlite` cannot reach them: Turso offers no extension, VFS or server mode that upstream SQLite can use, and a file with Turso's MVCC or encryption turned on is refused by `node:sqlite` as "file is not a database". Each feature therefore needs Turso as the engine first. Swapping the engine now, with no feature turned on, turns each later feature into a small change on top of it instead of an engine migration.

<!-- ce-section: work-relationships -->
### How This Work Fits Together

This plan covers only the engine swap. The areas below are the current understanding of what follows, not a committed roadmap; each would get its own brainstorm.

- **Concurrent writes (MVCC)** for the task graph. Depends on this work. Still to decide: how the graph's rules (no cycle, close only with no open blocker) hold under snapshot isolation, where two links written at once can form a cycle without a write conflict.
- **Encryption at rest.** Depends on this work. Still to decide: where the key comes from.
- **Sync with another copy.** Depends on this work.
- **Change feed (CDC).** Depends on this work. Can proceed independently of the others.

### Key Decisions

- **Turso replaces `node:sqlite` in both databases.** (session-settled: user-directed — chosen over keeping `node:sqlite`: Turso has more native features for the long term, and `node:sqlite` can use none of them.) Governs R1, R2.
- **Both files stay in WAL mode; MVCC is later work.** WAL keeps one writer at a time, which the task graph's benchmark of 2026-10-20 showed handles concurrent claims, and keeps the files readable by standard SQLite tools. (session-settled: user-directed — chosen over turning on MVCC in this work, after seeing that MVCC makes the files unreadable to SQLite tools, that snapshot isolation lets two concurrent links form a cycle, and that Turso's manual still calls MVCC not production ready.) Governs R3.
- **The server keeps running on Node, with Turso installed beside the bundle.** Turso is a native addon, and a native binary cannot be inlined into `server.mjs`. (session-settled: user-directed — chosen over a single executable built with Bun's compiler: importing the library is enough.) Governs R7.
- **The server runs only where Turso publishes a prebuilt binary.** Turso 0.8.3 ships Linux x64 and arm64 with glibc, macOS on Apple silicon and Windows x64; Intel Macs and musl Linux (Alpine) are not supported. (session-settled: user-approved — stated with the platform list in the scope synthesis; the user confirmed.) Governs R7.
- **`@sextou/tasks` gains Turso as its first runtime dependency.** It still imports no sextou package and knows nothing of organizations. (session-settled: user-approved — stated in the scope synthesis; the user confirmed.) Governs R2.
- **Only the server process opens each file.** Turso does not support several processes on one file, which `node:sqlite` with `busy_timeout` did. The server is already the only process that opens them. Governs R6.
- **Operations may become asynchronous.** Turso's default API and drizzle's Turso driver are async, so callers of both packages may need `await`. What each operation does stays the same. Governs R1, R2.

### Requirements

**Databases**

- R1. `sextou.db` opens through Turso, and `@sextou/data` queries it through drizzle with migrations applied exactly as today: pending ones in one transaction, and a refusal that leaves the file as it was when the file records a migration this server doesn't ship.
- R2. The task graph opens through Turso, and every behavior `@sextou/tasks` has today holds unchanged: its schema steps and refusal of a newer file, one transaction per write that keeps open-blocker counts in step, cycle refusal, the close rule, the ready list by assignee, refusals returned as results and storage errors thrown.
- R3. Both files run in WAL mode with one writer at a time, and stay files that standard SQLite can open.
- R4. The data directory, both files and every sidecar file Turso writes are readable only by their owner, and an acknowledged task graph write survives a power cut, as today.
- R5. The health endpoint still reports the database as `up` or `down` and never throws.

**Server and build**

- R6. The server opens both databases before listening, exits with 1 without listening when either fails to open, and closes both on SIGINT or SIGTERM, as today.
- R7. The built server runs with Node and Turso's installed package for its platform; the bundle keeps inlining every other dependency, so no other native dependency appears.

**Docs**

- R8. AGENTS.md describes both packages on Turso instead of `node:sqlite`, including that the bundle needs Turso's package beside it and the platforms the server runs on.

### Success Criteria

- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass, with every source file at 90% coverage or more in each suite.
- The existing tests for both packages' rules pass on Turso without loosening any assertion. A test that depends on `node:sqlite` itself changes only to reach Turso.
- No source file outside tests imports `node:sqlite`.

### Scope Boundaries

- MVCC and concurrent writes, encryption at rest, sync, CDC, asynchronous I/O and vector search are later work (see How This Work Fits Together).
- Backups. Turso is pre-1.0 and recommends keeping them; this work adds none.
- Platforms Turso does not publish binaries for, and building Turso from source.
- Running the server on Bun or as a compiled executable.

### Dependencies / Assumptions

- Turso's embedded package for Node is `@tursodatabase/database`, at 0.8.3 (2026-10-12) on npm; it is pre-1.0.
- drizzle-orm `1.0.0-rc.4`, already pinned in `@sextou/data`, ships the `drizzle-orm/tursodatabase/database` driver and its migrator, with `@tursodatabase/database >=0.6.0-pre.28` as a peer.
- Turso 0.8.3 runs what the task graph needs: `WITH RECURSIVE` (since 0.8.0), partial indexes, `BEGIN IMMEDIATE`, `PRAGMA user_version`, and foreign keys with `ON DELETE CASCADE` once `PRAGMA foreign_keys` is on. These were probed against 0.8.3 on 2026-10-21; Turso's COMPAT.md still lists `WITH RECURSIVE` as unsupported and is out of date on that point.
- Turso's errors carry no SQLite result code (a compat error has `code = "GenericFailure"` and a message such as "step failed: FOREIGN KEY constraint failed"). No sextou source reads SQLite error codes today.

### Outstanding Questions

**Deferred to Planning**

- Whether Turso plans the ready list as a search of the `task_ready` partial index, which `packages/tasks/src/graph.test.ts` checks with `EXPLAIN QUERY PLAN`. If it doesn't, stop and report to the owner rather than pick another index.
- How Turso provides what `synchronous = FULL` and `busy_timeout` give the task graph today, and which sidecar files it writes for R4.
- Which of Turso's two APIs each package uses: the async default, or the synchronous better-sqlite3-style `@tursodatabase/database/compat`, which keeps transactions synchronous but lacks some functions.
- How the Turso package and its per-platform binary package fit the organization's pnpm policy (versions at least a day old, trust policy) and CI's knip.

### Sources / Research

- Turso README FAQ, on Turso Database replacing libSQL as the main direction and being pre-1.0: https://github.com/tursodatabase/turso#faq
- Turso SQL compatibility: https://github.com/tursodatabase/turso/blob/main/COMPAT.md, and the changelog entry for `WITH RECURSIVE` in 0.8.0: https://github.com/tursodatabase/turso/blob/main/CHANGELOG.md
- Turso manual, on journal modes, MVCC's status and multi-process access: https://github.com/tursodatabase/turso/blob/main/docs/manual.md
- Turso JavaScript API: https://github.com/tursodatabase/turso/blob/main/docs/javascript-api-reference.md and https://docs.turso.tech/connect/javascript
- Turso concurrent writes: https://docs.turso.tech/tursodb/concurrent-writes
- drizzle's Turso driver: https://orm.drizzle.team/docs/connect-turso-database
- Probes of `@tursodatabase/database` 0.8.3 on Node 26.8.1, linux-x64, on 2026-10-21: Turso and `node:sqlite` each read and wrote a WAL file the other made, with `integrity_check` ok; `node:sqlite` refused a file with Turso's MVCC or encryption on; the WASM build fails in Node (it needs a browser `Worker` and OPFS).
- Prior plans: `.compound-engineering/artifacts/plans/2026-10-19-1641-feat-sqlite-data-access-plan.md` (KD7 chose `node:sqlite` so `server.mjs` needs only Node, which R7 replaces) and `.compound-engineering/artifacts/plans/2026-10-20-1830-feat-sqlite-task-graph-plan.md` (the 2026-10-20 benchmark and the task graph's pragmas).
