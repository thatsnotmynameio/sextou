---
title: Link and Unlink Tasks Through the Server - Plan
type: feat
date: 2026-10-27
topic: link-unlink-tasks
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Link and Unlink Tasks Through the Server - Plan

## Goal Capsule

- **Objective:** a caller of the server can make one task wait for another, and can release a task held by a blocker that failed or was cancelled.
- **Means:** two procedures, `tasks.link` and `tasks.unlink`, over the `link` and `unlink` that `@sextou/tasks` already has (KTD2).
- **Product authority:** the repository owner. Resolves issue #106.
- **Authority order:** the Product Contract's Requirements win on behavior, the KTDs on mechanism, and a unit overrides neither.
- **Stop conditions:** stop and report if delivering a requirement would need a change to `@sextou/tasks`.
- **Execution profile:** one branch and one pull request. Units land in order, and the full Verification Contract runs before the push.
- **Open blockers:** none.

---

## Product Contract

Product Contract preservation: Product Contract unchanged. Its question deferred to planning is answered by KTD1, and removed here.

### Summary

The server gets `tasks.link` and `tasks.unlink`, which add and remove a `blocked_by` link between two tasks under the rules `@sextou/tasks` already enforces.
`tasks.create` doesn't change: a caller who needs a new task to wait for a blocker creates it under an assignee no runner serves, links it, then assigns it.

### Problem Frame

`@sextou/tasks` links a task to the tasks that block it, and a task becomes ready only once its blockers succeeded or were skipped.
The server exposes neither `link` nor `unlink`, so no caller can create a link, and every task is ready as soon as it is created.
A task whose blocker failed or was cancelled waits until that link is removed, and no caller can remove it either.

A task is ready the moment `tasks.create` answers it.
A caller that creates a task and then links it races the runners: one may claim the task in between, and the link is then refused because the task is no longer open.

### Key Decisions

- **Only `tasks.link` and `tasks.unlink`; callers avoid the creation race with `tasks.assign`.** (session-settled: user-directed — chosen over letting `tasks.create` take the task's blockers and link them in the same write, which changes `@sextou/tasks`' `createTask`, and over leaving the race to callers unexplained: the workaround needs no new behavior.) Governs R1, R2, R7.
- **Neither procedure takes an actor, and no link change is recorded.** (session-settled: user-approved — chosen over recording who linked, which `@sextou/tasks` doesn't do: links aren't a task's state, whose changes are the only ones recorded.) Governs R6.

### Requirements

**The procedures**

- R1. The server exposes `tasks.link`, which makes a task wait for a blocker, given the task's id and the blocker's id.
- R2. The server exposes `tasks.unlink`, which removes the link between a task and a blocker, given the same two ids.
- R3. Both keep `@sextou/tasks`' rules: `link` refuses a task or blocker that doesn't exist, a task as its own blocker, a task that isn't open, and a link that would close a cycle; `unlink` refuses a task or blocker that doesn't exist and a task that isn't open.
- R4. Linking a pair already linked, and unlinking a pair not linked, succeed and change nothing, so a caller can send either again when its answer was lost.
- R5. Each refusal reaches the caller as an error naming its reason, the way the other tasks procedures answer theirs; a task as its own blocker and a cycle are reasons the server doesn't answer yet.
- R6. Neither procedure takes an actor.

**What callers learn**

- R7. The procedures' comments and AGENTS.md tell a caller how to create a task that waits for a blocker before any runner can claim it: create it under an assignee no runner serves, link it, then hand it to its real assignee with `tasks.assign`.
- R8. The `run-server` skill's smoke links and unlinks tasks through the server.

### Acceptance Examples

- AE1. **Covers R1.** Given open tasks A and B, when a caller links A to blocker B, then no runner claims A until B succeeded or was skipped.
- AE2. **Covers R2.** Given A blocked by B, and B failed, when a caller unlinks A from B, then A is ready.
- AE3. **Covers R3, R5.** Given A blocked by B, when a caller links B to blocker A, then the call is refused as a cycle and nothing changes.
- AE4. **Covers R3.** Given A running, when a caller links A to any blocker, then the call is refused because A isn't open.
- AE5. **Covers R4.** Given A blocked by B, when a caller links A to B again, then the call succeeds and A still has one link to B.
- AE6. **Covers R7.** Given a runner serving assignee `dev`, when a caller creates A under an assignee no runner serves, links it to an open blocker B, then assigns it to `dev`, then the runner doesn't claim A while B is open.

### Scope Boundaries

- `tasks.create` taking a task's blockers, linked in the same write.
- Recording who linked or unlinked a task, and when.
- A procedure that reads a task's links or blockers.
- Anything in the web app.
- Any change to `@sextou/tasks`.

### Sources / Research

- `packages/tasks/src/graph.ts`: the `Graph` interface's `link` and `unlink` and their refusals, and their implementation, including the cycle check (`reaches`).
- `apps/server/src/trpc.ts`: `refusalCodes`, which maps each refusal the server answers to an HTTP code, and `accepted`.
- `apps/server/src/tasks.ts`: the `Tasks` port and `Refusal`, which lack link, unlink and the two new reasons.
- `apps/server/src/modules/tasks/tasks.router.ts`: `create`, `cancel` and `assign`, the procedures the new ones sit beside.
- `apps/server/.claude/skills/run-server/SKILL.md`: the smoke R8 extends.
- `CONCEPTS.md`, the task graph: when a task is ready, and that a failed or cancelled blocker holds it until the link is removed.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **A task as its own blocker answers `BAD_REQUEST`, and a cycle answers `CONFLICT`, each with the refusal as the message.** A task blocking itself is wrong whatever the graph holds, like an invalid input. A cycle depends on the links already there, like `not_open`. `accepted` in `apps/server/src/trpc.ts` already puts the refusal in the message, so a caller tells `cycle` from `not_open` the way it tells `lease_lost` from `already_finished` today. Governs R5.
- KTD2. **The port, the service and the procedures pass `{ taskId, blockerId }` through as the library names them, and both procedures answer `null`, like `tasks.assign`.** The server adds nothing to a link, so a translation layer would only rename fields. `idSchema` checks both ids, as it does for `cancel` and `assign`. Governs R1, R2, R6.
- KTD3. **The server's tests prove the pass-through, not the graph's rules in depth.** `@sextou/tasks`' own suite owns the rules and their edge cases. The service's integration test runs each rule once against a real tasks database (one case per refusal, idempotence and the hold), because the service's whole job is the pass-through, and the router test maps every refusal to its code. Governs R3, R4, R5.

### Assumptions

- Nothing outside `apps/server` reads the `Refusal` type, so adding two reasons breaks no other package. Checked: the runner and the web app import only `AppRouter`.

---

## Implementation Units

### U1. The tasks service links and unlinks

**Goal:** the `Tasks` port and the service carry `link` and `unlink`, and the server knows the two new refusals.

**Requirements:** R3, R4, R5, R6; KTD1, KTD2, KTD3.

**Dependencies:** none.

**Files:**

- `apps/server/src/tasks.ts`
- `apps/server/src/tasks-service.ts`
- `apps/server/src/trpc.ts`
- `apps/server/tests/tasks.ts`
- `apps/server/tests/integration/tasks-service.test.ts`

**Approach:**

1. Add `sameTask: 'same_task'` and `cycle: 'cycle'` to `Refusal` in `tasks.ts`, and `link` and `unlink` to the `Tasks` port, each refused with the reasons the library's `Graph` declares for it (`packages/tasks/src/graph.ts`).
2. Add both to the service as calls to the library's `link` and `unlink`, shaped like `assign`.
3. Map the new reasons in `refusalCodes`, per KTD1. The `satisfies Record<Refusal, …>` check fails to compile until both are there.
4. Add `link` and `unlink` to `fakeTasks`, rejecting when a test doesn't stub them.

**Patterns to follow:** `assign` in `tasks-service.ts` and in the `Tasks` port; the service tests that create tasks and claim them in `tasks-service.test.ts`.

**Test scenarios:**

- Covers AE1. Given open tasks A and B under `dev`, with A more urgent, linking A to B succeeds, and a claim for `dev` returns B, not A.
- Covers AE2. Given A linked to B and B claimed and finished as failed, a claim for `dev` returns no task; after unlinking A from B, a claim returns A.
- Covers AE5. Linking A to B a second time succeeds, and unlinking A from B twice succeeds both times.
- Covers AE3. Given A linked to B, linking B to A is refused as `cycle`.
- Linking A to A is refused as `same_task`.
- Covers AE4. Given A running, linking A to B and unlinking A from B are both refused as `not_open`.
- Linking or unlinking with an unknown task id or blocker id is refused as `not_found`.
- Linking or unlinking with an id that is not a string is refused as `invalid`, as renew's test does.
- Linking or unlinking with an empty id is refused as `not_found`, since the library checks only that an id is a string; the server's `idSchema` turns it into `BAD_REQUEST` before it gets here (U2).
- After a failed start, `link` and `unlink` reject with the error `start` rejected with, as the other calls do in the existing test.

**Verification:** the server's integration suite passes at the 90% floor for `tasks-service.ts`, and `pnpm typecheck` passes with the new refusal codes.

### U2. The `tasks.link` and `tasks.unlink` procedures

**Goal:** callers reach `link` and `unlink` over tRPC.

**Requirements:** R1, R2, R5, R6, R7; KTD1, KTD2.

**Dependencies:** U1.

**Files:**

- `apps/server/src/modules/tasks/tasks.schema.ts`
- `apps/server/src/modules/tasks/tasks.router.ts`
- `apps/server/tests/unit/modules/tasks/tasks.router.test.ts`

**Approach:**

1. Add one input schema with `taskId` and `blockerId`, both `idSchema`, used by both procedures (KTD2).
2. Add `link` and `unlink` mutations to `tasksRouter` beside `assign`, each passing the input to `ctx.tasks` through `accepted` and answering `null`.
3. Give each a comment saying what it does. On `link`, say how to create a task that waits for a blocker before any runner can claim it, per R7.

**Patterns to follow:** `assign` in `tasks.router.ts` and its tests.

**Test scenarios:**

- `tasks.link` passes the task id and blocker id it was given to the tasks and answers `null`.
- `tasks.unlink` passes the task id and blocker id it was given to the tasks and answers `null`.
- `tasks.link` turns each of `invalid`, `not_found`, `same_task`, `not_open`, `cycle` and `timeout` into its code (`BAD_REQUEST`, `NOT_FOUND`, `BAD_REQUEST`, `CONFLICT`, `CONFLICT`, `TIMEOUT`), with the refusal as the message.
- `tasks.unlink` turns each of `invalid`, `not_found`, `not_open` and `timeout` into its code, with the refusal as the message.
- `tasks.link` and `tasks.unlink` refuse an empty `taskId` or `blockerId` as `BAD_REQUEST` without calling the tasks.

**Verification:** the server's unit suite passes at the 90% floor for the router and the schema.

### U3. The smoke test and the docs describe linking

**Goal:** the `run-server` smoke runs the hold-then-assign workflow over HTTP, and AGENTS.md tells callers about the procedures and the workflow.

**Requirements:** R7, R8; AE6.

**Dependencies:** U2.

**Files:**

- `apps/server/.claude/skills/run-server/driver.mjs`
- `apps/server/.claude/skills/run-server/SKILL.md`
- `AGENTS.md`

**Approach:**

1. In `smoke`, after the existing steps and under two assignees of the run's own (one a runner claims, one no runner serves), run these steps:
   1. Create a blocker under the claimed assignee, and a more urgent task under the unserved one.
   2. Link the task to the blocker, then send the same link again.
   3. Link the blocker to the task, expecting `409 cycle`.
   4. Assign the task to the claimed assignee. A claim returns the blocker.
   5. Complete the blocker as failed. A claim then returns no task.
   6. Unlink the task from the blocker. A claim then returns the task. Complete it.
2. In `SKILL.md`, add the new steps to the `smoke` row, `tasks.link`/`unlink` to the description's procedure list, and an example `call` for `tasks.link`.
3. In AGENTS.md, add `tasks.link` and `tasks.unlink`, and how to create a task that waits for a blocker, to the server's bullet. Add "link and unlink" to the `tasks/` line of the Structure tree.

**Patterns to follow:** the existing `step` calls in `smoke`; the `uses` plan's U5 for how a smoke and AGENTS.md changed together (`.compound-engineering/artifacts/plans/2026-10-27-1232-feat-task-uses-workflow-plan.md`).

**Test expectation:** none, because the smoke is a driver an agent runs, not a suite. It passes against a server built from this branch.

**Verification:** `node .claude/skills/run-server/driver.mjs smoke`, from `apps/server`, prints every step `ok`, including the new ones, and passes again on the same server.

---

## Verification Contract

| Check           | Command                                                                                        | Applies to                                         |
| --------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Lint and format | `pnpm lint`                                                                                    | every unit                                         |
| Gate rules      | `pnpm exec oxlint -c .oxlintrc.gates.json .`                                                   | every unit                                         |
| Types           | `pnpm typecheck`                                                                               | every unit; covers the web app through `AppRouter` |
| Server          | `pnpm --filter @sextou/server test` and `pnpm --filter @sextou/server test:mutation`           | U1, U2                                             |
| Server smoke    | `node .claude/skills/run-server/driver.mjs smoke`, from `apps/server`, as its SKILL.md runs it | U3                                                 |

Each `test` run must reach the 90% floor in every file, and the mutation run must kill 80% of mutants.

---

## Definition of Done

- Every check in the Verification Contract passes.
- Over HTTP, a task linked to an open blocker isn't claimed, and unlinking a failed blocker makes it ready (AE1, AE2, AE6).
- `packages/tasks` is unchanged.
- No code from abandoned attempts is left in the diff.
