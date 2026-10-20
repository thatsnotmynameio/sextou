---
title: Task Assignee and Description - Plan
type: feat
date: 2026-10-20
topic: task-assignee-and-description
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Task Assignee and Description - Plan

## Goal Capsule

- **Objective:** Every task in the task graph says who may take it and what it asks for, either inline or by pointing to where the text lives. Whoever takes work (#41) can list only the ready tasks it may take.
- **Means:** three fields on a task in `@sextou/tasks` and an assignee filter on its ready list, written into the schema's first step as if the database were being created now (KD4).
- **Product authority:** the repository owner. Only the three fields and the filtered ready list are in scope. Claiming, editing a task and the other fields beads has are not.
- **Stop conditions:**
  - Stop and report, with the query plan SQLite printed, if SQLite will not plan the filtered ready list as a search of `task_ready` by assignee (KTD3). Do not switch to another index or to SQL built per call without the owner.
- **Execution profile:** one pull request against `main`, squash-merged. `ce-work` implements; the user reviews and merges.
- **Open blockers:** none.

---

## Product Contract

Product Contract preservation: requirements unchanged. The two questions deferred to planning are answered by KTD3 and KTD4 and removed from Outstanding Questions.

### Summary

A task gets an assignee it must always have, plus an optional description and an optional source path pointing to text kept elsewhere. The ready list takes the assignees the caller may work for and returns only their ready tasks, in the order it uses today.

### Problem Frame

The task graph from #44 (`.compound-engineering/artifacts/plans/2026-10-20-1830-feat-sqlite-task-graph-plan.md`) gives a task a title, a kind, a priority and a parent (`packages/tasks/src/migrations.ts:13-22`). A task can't say what work it asks for beyond its title, and it can't say who may take it. The actors in #41 need both: each step goes to an actor or to a role's pool ("three `bot-dev-N` actors taking work assigned to `dev`"), and the actor needs to know what the step asks.

Long text often already lives somewhere else, such as an issue on GitHub or a file on the user's machine. Copying it into the task would leave two copies to keep in step.

beads, which the task graph replaced, keeps the same three things (`internal/types/types.go` in steveyegge/beads): `Description`, `Assignee` and `ExternalRef`. It also keeps about twenty other fields, which this work leaves out (KD1).

### Key Decisions

- KD1. **Only description, source path and assignee are added.** The other fields beads keeps wait until a feature needs them. No task data exists yet, so adding a field later loses nothing. (session-settled: user-approved — chosen over also adding the close time and outcome, the task's creator, or labels and free metadata.) Governs R1–R4.
- KD2. **The ready list filters by assignee in this work.** Filtering is not left to #41. (session-settled: user-directed — chosen over storing the assignee and returning it with the task, with filtering left to #41's get next.) Governs R6–R8.
- KD3. **The ready list always takes a list of assignees.** An actor passes its own name and its roles in one call, and the list has a single query shape. (session-settled: user-approved — chosen over an optional list that keeps an unfiltered ready list, and over one assignee per call.) Governs R6, R8.
- KD4. **The fields go into the schema's first step, edited in place, with no second step.** No route writes tasks yet, so no tasks file holds data. This is a one-time exception to the rule that a merged step is never edited. (session-settled: user-directed — chosen over a second migration step that adds the columns: "Tem ninguém usando. Finge que tá criando o banco agora.") Governs R9.
- KD5. **The library trusts the assignee and the source path as given.** It never checks that an assignee names an actor or a role, or that a source path is a valid URL or an existing file. Actors and roles are sextou's domain, not the library's. Governs R1, R3.

### Requirements

**Task fields**

- R1. Every new task has an assignee: a string naming who may take it, such as an actor, a role or any other name the caller uses.
- R2. A new task may have a description: free text saying what the task asks for.
- R3. A new task may have a source path: a URL or a file path where the task's longer text lives, such as a GitHub issue's URL or a local file. The library stores it as text and never reads what it points to.
- R4. Every task the library returns carries its assignee, its description and its source path. The description and the source path are null when the task was given none or a blank one.
- R5. Creating a task is refused as invalid, with nothing written, when the assignee is missing, not a string, or blank.

**The ready list**

- R6. The ready list takes a non-empty list of assignees and the limit it takes today, and returns only the ready tasks whose assignee is one of them, matched exactly.
- R7. The ready tasks of all the assignees asked for come back as one list, in the existing order (most urgent first, then oldest first), up to the limit.
- R8. Asking for the ready list with no list of assignees, or an empty one, is refused as invalid.

**Schema and docs**

- R9. The tasks database's first schema step creates the three fields, and the library ships no second step.
- R10. CONCEPTS.md's Task graph entry says that a task has an assignee and may have a description and a source path, and that the ready list is asked for by assignee.

### Acceptance Examples

- AE1. **Covers R6, R7.** Given ready tasks A (assignee `dev`, priority 2), B (`bot-dev-1`, priority 1) and C (`qa`, priority 0), when the ready list is asked for `bot-dev-1` and `dev`, it returns B, then A, and leaves out C.
- AE2. **Covers R6.** Given a ready task assigned to `dev`, when the ready list is asked for `Dev` or `dev-1`, the task is not in it.
- AE3. **Covers R5.** When a task is created with the assignee `"   "`, the create is refused as invalid and no task exists afterwards.
- AE4. **Covers R2, R3, R4.** When a task is created with the description `"   "` and no source path, the returned task has a null description and a null source path.
- AE5. **Covers R8.** When the ready list is asked for an empty list of assignees, the call is refused as invalid.

### Success Criteria

- The filtered ready list stays as fast as the unfiltered one did in #44's benchmark: low milliseconds at 50k tasks. The time does not grow with the number of closed tasks or with other assignees' ready tasks.

<!-- ce-section: work-relationships -->

### How This Work Fits Together

This plan covers the task's assignee, description and source path, and the ready list filtered by assignee. The breakdown below is the current understanding, not a committed roadmap.

- Claiming and closing under a reservation (#41).
  - Depends on this plan's assignee and filtered ready list.
  - Still to decide in #41: how an actor learns which assignees it may pass (its name and its roles), and whether the assignee or a separate field records who holds a reservation.
- Retry and check of a flow's steps (#43): can proceed independently of this plan. An acceptance criteria field may come back there.

### Scope Boundaries

- Changing a task's assignee, description or source path after it is created. Editing any field stays out of scope, as in #44.
- The other fields beads keeps: close time and outcome, the task's creator, labels, free metadata, start time, due dates, estimates and the rest (KD1).
- Checking that an assignee names an actor or a role, or that a source path is valid or reachable (KD5).
- Deciding which assignees an actor may take work for. The caller passes the strings.
- A ready list with no assignee filter (KD3).
- A migration step for tasks files that #44's server already created (KD4).
- HTTP routes, contract schemas and web screens for tasks.

### Dependencies / Assumptions

- No route reaches the task graph (AGENTS.md, `apps/server`), so no tasks file holds a task.
- A development machine that ran #44's server has a `default.tasks.db` with the old first step recorded as applied. The new library would treat that file as up to date, then fail to prepare its statements against the missing columns, so the server exits with 1 at start ("Could not open the task graph at ...: table task has no column named assignee"). The pull request says to delete that file by hand.

### Sources / Research

- `packages/tasks/src/migrations.ts`: the first schema step, `task_ready` and the rule against editing a merged step.
- `packages/tasks/src/graph.ts`: `createTask`, `listReady` and the `invalid` refusal.
- `.compound-engineering/artifacts/plans/2026-10-20-1830-feat-sqlite-task-graph-plan.md`: the benchmark findings (KTD7), the scope that left assignee to #41, and the ready list's order (R14).
- beads' `Issue` type (`internal/types/types.go` in steveyegge/beads), the benchmark for the field list: `Description`, `Assignee` and `ExternalRef` map to this plan's three fields.
- Issue #41: steps assigned to an actor, or to a role's pool that any actor of that role can take.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The three fields are columns of `task`, written into the first step in `packages/tasks/src/migrations.ts`.** `assignee` is `TEXT NOT NULL`; `description` and `source_path` are nullable `TEXT`. The rule against editing a merged step stays in the code and in AGENTS.md; this is the one exception KD4 records. Implements R1–R3, R9, KD4.
- KTD2. **Input is trimmed and checked the way title and kind are.** The assignee must be a string that is non-empty after trimming, or the create is refused as `invalid` (R5). A description or source path that is given but is not a string is refused as `invalid`, as `parentId` is today, rather than dropped without a word. A string that trims to empty is stored as null (R4). Values are trimmed at the ends only, so a description keeps its inner line breaks. The source path is never parsed or opened (KD5). Implements R1–R5.
- KTD3. **The ready list reads one partial index on assignee then priority, and sorts only the rows it found.** `task_ready` becomes an index on `(assignee, priority)` with the same `WHERE status = 'open' AND open_blockers = 0`, and stays the only index that covers the query, per #44's wrong-index finding. The query matches the assignee with `IN (SELECT value FROM json_each(?))`, so one prepared statement serves a list of any length and SQLite searches the index once per assignee. The rows of several assignees then need a sort by priority and rowid before the limit. That sort covers only the requested assignees' ready tasks, so the time grows neither with closed tasks nor with other assignees' ready tasks, as the Success Criteria require. Keeping the index on priority alone and filtering during the scan was rejected: it reads other assignees' ready tasks in priority order until it fills the limit. Implements R6, R7.
- KTD4. **`listReady` takes `{ assignees, limit }`.** `assignees` must be a non-empty array whose every entry is a string that is non-empty after trimming; anything else is refused as `invalid` (R8). Entries are trimmed before the match, so the string that created a task finds it. Duplicates are harmless under `IN`. The list has no upper bound, because `json_each` takes one bound value whatever its length. The limit keeps its current rule. Implements R6–R8.
- KTD5. **`Task` gains `assignee`, `description` and `sourcePath`; `NewTask` gains `assignee` and optional `description` and `sourcePath`.** The camelCase names follow `parentId` and `timeCreated`. Implements R4.

### Assumptions

- `node:sqlite` on the repo's Node 24 ships SQLite with JSON functions built in, as every SQLite since 3.38 does. U1's query-plan test checks that `json_each` reaches the index.
- No `default.tasks.db` exists outside development machines, because no route writes tasks and no release shipped one.

---

## Implementation Units

### U1. Add the fields and the filtered ready list to the task graph

**Goal:** a task carries its assignee, description and source path, and the ready list returns only the requested assignees' ready tasks.

**Requirements:** R1–R9 (KD2–KD5); KTD1–KTD5.

**Dependencies:** none.

**Files:**

- `packages/tasks/src/migrations.ts`
- `packages/tasks/src/migrations.test.ts`
- `packages/tasks/src/graph.ts`
- `packages/tasks/src/graph.test.ts`
- `apps/server/src/main.test.ts`

**Approach:**

1. Edit the first step: the three columns (KTD1) and `task_ready` on `(assignee, priority)` (KTD3). Update the comment above the step to say the index orders by assignee, then priority, then rowid.
2. In `graph.ts`, extend `Task`, `NewTask` and `toTask` (KTD5), the insert statement, and `createTask`'s validation (KTD2).
3. Replace the `ready` statement and `listReady` with the filtered form (KTD3, KTD4). Keep the statement's `WHERE` matching the index's, as its comment says today, and update that comment and the `Graph` interface's comment on `listReady`.
4. Update `tasksOpen` in `apps/server/src/main.test.ts` to the new `listReady` call; it only checks that the handle still answers.

**Patterns to follow:** `trimmed` and `isId` in `graph.ts`; the existing `listReady` query-plan test, which reads the statement's `sourceSQL` back from the `prepare` spy; the test helpers `create` and `ready`, which gain an assignee argument with a default.

**Test scenarios:**

- Creating a task with the assignee `'  dev '`, a description with inner line breaks and padded ends, and a source path returns the whole task with the three values trimmed at the ends only, and the row holds the same values.
- Creating a task with only an assignee returns a null description and a null source path.
- Covers AE4. Creating a task with the description `"   "` and no source path returns both as null.
- Covers AE3. Creating a task with the assignee `"   "` is refused as `invalid`, and the task table stays empty.
- Creating a task with no assignee, or with the number `7` as assignee, is refused as `invalid`.
- Creating a task with a description or a source path that is not a string (`42`) is refused as `invalid`, writing nothing.
- A source path of `https://github.com/o/r/issues/1` and one of `./notes/task.md` are both stored as given.
- Covers AE1. Ready tasks A (`dev`, priority 2), B (`bot-dev-1`, priority 1) and C (`qa`, priority 0), asked for `['bot-dev-1', 'dev']`, come back as B, then A.
- Covers AE2. A ready task assigned to `dev` is not in the list asked for `['Dev']` or `['dev-1']`.
- Tasks of two assignees created alternately at the same priority, in one millisecond, come back in creation order across both, and a limit of 3 returns the first three of that merged order.
- The entry `' dev '` finds tasks assigned to `dev`, and `['dev', 'dev']` returns each task once.
- A blocked task and a closed task assigned to `dev` stay out of `dev`'s list.
- Covers AE5. Asking with `[]` is refused as `invalid`.
- Asking with no `assignees`, with the string `'dev'` instead of an array, or with an entry that is `''`, `'  '` or a number, is refused as `invalid`.
- The existing limit refusals (0, -1, 1.5, NaN) still hold with a valid list of assignees.
- The ready statement's query plan searches `task_ready` by assignee and never scans the task table. The exact plan rows are settled in implementation.
- The shipped first step creates `task` with `assignee` not null and `description` and `source_path` nullable.
- The random-operations property test still passes with tasks spread across a few assignees.

**Verification:** the tasks and server unit suites pass at 90% per file, and `pnpm typecheck` passes with the new `listReady` call.

### U2. Describe the fields in CONCEPTS.md

**Goal:** the shared vocabulary says what a task carries and how ready work is asked for.

**Requirements:** R10.

**Dependencies:** U1.

**Files:** `CONCEPTS.md`

**Approach:** in the Task graph entry, add that a task names an assignee who may take it (any name the caller uses, not checked), may carry a description and a source path pointing to text kept elsewhere, and that ready tasks are asked for by a list of assignees.

**Test expectation:** none -- a glossary change.

**Verification:** the entry matches U1's behavior and names no file, column or function.

---

## Documentation / Operational Notes

- The pull request description tells a development machine that ran #44's server to delete `default.tasks.db` and its `-wal` and `-shm` files from the data directory before starting the new server, and names the symptom of skipping it: the server exits at start because the task table has no `assignee` column (KD4).

---

## Verification Contract

| Gate            | Command          | Proves                                                     |
| --------------- | ---------------- | ---------------------------------------------------------- |
| Lint and format | `pnpm lint`      | oxlint and oxfmt pass                                      |
| Types           | `pnpm typecheck` | `@sextou/tasks` and `apps/server` compile with the new API |
| Unit suites     | `pnpm test:unit` | U1's tests pass at 90% per file in each suite              |
| Both suites     | `pnpm test`      | the integration stories still pass; run before the PR      |
| Build           | `pnpm build`     | the server bundle still builds                             |

---

## Definition of Done

- Every unit's Verification holds, and the Verification Contract's gates pass.
- R1–R10 each trace to a passing test or the CONCEPTS.md change, and AE1–AE5 each have a test.
- The first schema step is still the only step in `packages/tasks/src/migrations.ts`.
- The pull request description carries the note to delete a development `default.tasks.db`.
- No code from abandoned attempts is left in the diff.
