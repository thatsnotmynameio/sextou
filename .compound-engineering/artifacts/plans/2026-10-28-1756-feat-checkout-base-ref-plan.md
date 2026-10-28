---
title: Let git/checkout Bring the Base Branch - Plan
type: feat
date: 2026-10-28
topic: checkout-base-ref
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Let git/checkout Bring the Base Branch - Plan

## Goal Capsule

- **Objective:** a step that runs after `git/checkout` reads, in its workspace, the commits a branch added and its diff against its base, as a pull request shows them, even after the base has moved on.
- **Means:** `git/checkout` takes an optional `base` branch from the task's context and fetches it with the ref, with full history for both (KTD1, KTD2).
- **Product authority:** the repository owner. Resolves issue #135, part of #132. The rest of #132's chain is not active scope.
- **Authority order:** the Product Contract's Requirements win on behavior, the KTDs on mechanism, and a unit overrides neither.
- **Stop conditions:** stop and report if keeping an existing checkout test green, Taskfile tests included, would need a changed expectation, since that breaks R6.
- **Execution profile:** one branch and one pull request. Units land in order, and the full Verification Contract runs before the push.
- **Open blockers:** none.

---

## Product Contract

Product Contract preservation: requirements unchanged; R7 reworded, no scope change. The two questions deferred to planning, whether the ref and the base come in one fetch or two and how the test repository gets a base that moved on, are answered by KTD1 and U2 and removed here.

### Summary

The task's context can name a `base` branch, which `git/checkout` fetches along with the ref, with the full history of both.
The clone keeps the base as `origin/<base>`, so `git log origin/<base>..HEAD` and `git diff origin/<base>...HEAD` work in the workspace.
Without `base`, the checkout fetches one ref at depth 1, as it does today.

### Problem Frame

`git/checkout` fetches one ref at depth 1 and checks it out detached, so the clone holds a single commit with no parents and no other ref.
#132's chain needs more than that: the work skill (#139) reads `git log origin/<default>..HEAD`, and the validation (#142) needs the branch's diff against its base.
With one commit and no base, neither has anything to compare with.

### Key Decisions

- **The diff is the one a pull request shows, counted from the merge base.** The diff against the base's tip shows the base's newer changes reversed once the base moves. (session-settled: user-directed — chosen over the diff against the base's tip, and over the commit list only: the tip diff turns the base's progress into noise for every later step.) Governs R3, R4.
- **Full history of both refs.** (session-settled: user-directed — chosen over a partial clone without file contents, whose later diffs download contents from origin through a git outside the checkout's isolation, and over deepening in rounds until the merge base appears, which takes more code and more round trips.) It follows `actions/checkout`, which documents `fetch-depth: 0` for diffs. Governs R3.
- **The base is a branch, kept as `origin/<base>`.** The clone looks like an ordinary clone, so the skill copied from `ce-work` reads `origin/<default>` unchanged. (session-settled: user-directed — chosen over any ref under one fixed name sextou picks, which every step would have to know.) Governs R1, R2, R4.
- **The caller picks the ref, and a missing ref fails.** (session-settled: user-directed — chosen over checking out the base when the server has no such branch yet, and over leaving the question to #141.) Governs R7.

### Requirements

**The context**

- R1. The task's context may carry `base`, the name of a branch, which `git/checkout` reads alongside `repo`, `ref`, `path` and `server`.
- R2. A `base` that is empty, starts with `-`, or holds a character that would make it a refspec or split it into several arguments is refused with 2 before any git runs, as `ref` is today.

**What the clone holds**

- R3. With `base` set, the clone holds the full history of the ref and of the base, and no other branch, tag or ref.
- R4. The clone keeps the base as the remote-tracking branch `origin/<base>`, so `git log origin/<base>..HEAD` lists the ref's commits that are not on the base, and `git diff origin/<base>...HEAD` shows the ref's changes since the merge base.
- R5. HEAD stays detached on the ref, as today, and the ref gets no local branch.
- R6. Without `base`, the checkout fetches the ref at depth 1 with no other ref, as today.

**Failures**

- R7. A ref the server doesn't have, or a base the server doesn't have as a branch, fails the checkout with git's exit code, as a missing ref does today. A base that exists only as a tag or a commit SHA counts as missing, and neither case falls back to another ref.
- R8. The fetch of the base counts toward the same `CHECKOUT_TIMEOUT_MS` as every other git command of the checkout.

**Documentation**

- R9. `git/checkout`'s Taskfile, `sextou/development`'s Taskfile and AGENTS.md's description of `git/checkout` list `base` and what it brings.

### Acceptance Examples

- AE1. **Covers R3, R4.** **Given** a repository whose `main` gained a commit after `feat` branched from it, and `feat` holds two commits of its own, **when** the context names `ref: "feat"` and `base: "main"`, **then** `git log origin/main..HEAD` lists the two commits of `feat`, and `git diff origin/main...HEAD` shows only the changes of `feat`, none of the newer commit on `main`.
- AE2. **Covers R6.** **Given** a context without `base`, **when** the checkout runs, **then** the clone holds the ref's commit alone, with no parents, as today.
- AE3. **Covers R4.** **Given** `ref: "main"` and `base: "main"`, as on the work task's first run, **when** the checkout runs, **then** it succeeds, `git log origin/main..HEAD` lists nothing, and `git diff origin/main...HEAD` is empty.
- AE4. **Covers R7.** **Given** `base: "release"` on a server with no `release` branch, or `base: "v1.0"` where `v1.0` is only a tag, **when** the checkout runs, **then** it exits with git's code and checks nothing out.
- AE5. **Covers R2.** **Given** `base: "--upload-pack=x"` or `base: "main:refs/heads/x"`, **when** the checkout runs, **then** it exits with 2 and runs no git.

### Scope Boundaries

- Checking out the base when the branch doesn't exist yet. The caller picks the ref, so a retried first attempt of the work task starts from the base again, and its push collides with whatever the earlier attempt pushed. Handling that belongs to #141 and #136.
- Fetching notes (`refs/notes/…`), which belongs to #137.
- Tags: the checkout still fetches none.
- A partial clone, or deepening until the merge base appears, for repositories whose history makes the full fetch slow.
- Creating or continuing the branch, and pushing it: the work skill's (#139, #141) and #136's.
- A qualified name as `base` (`refs/heads/main`): the base is the short branch name, so a qualified one fails as a branch the server lacks (R7). Accepting both would give one branch two spellings; nothing in #132 writes the qualified one.

<!-- ce-section: work-relationships -->

### How This Work Fits Together

This plan covers only the base ref in `git/checkout`. The breakdown below is #132's current understanding, not a committed roadmap.

- The work skill (#139) and the work task (#141): depend on this for `git log origin/<base>..HEAD`, and own how the first run picks its ref.
- The validate task (#142): depends on this for the branch's diff against its base.
- Writing and reading notes (#137): can proceed independently of this. It adds its own fetch of the notes.
- Pushing a branch (#136): can proceed independently of this.

### Sources / Research

- `packages/workflows/git/checkout/checkout.ts`: today's fetch, `fetch -q --no-tags --depth=1 origin <ref>`, then `checkout --force --detach FETCH_HEAD`.
- `packages/workflows/git/checkout/settings.ts`: the rules `ref` is refused by, which R2 applies to `base`.
- Issue #132, "Shallow checkout" among its open questions, and its Level 1 flow for T1 and T2.
- `actions/checkout`'s README: `fetch-depth: 0` fetches all history, for steps that need it.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Two fetches, the base first.** The checkout first fetches `+refs/heads/<base>:refs/remotes/origin/<base>`, then the ref as today without `--depth=1`, and checks out `FETCH_HEAD`. The second fetch then leaves `FETCH_HEAD` on the ref alone, so the checkout step is unchanged. The objects the two refs share come over once, since the second fetch tells the server what the first brought. A single fetch of both would leave two lines in `FETCH_HEAD` and make the checkout depend on their order. A ref that is a commit SHA fetches its full history the same way, as GitHub serves any reachable commit and the test repository's `uploadpack.allowAnySHA1InWant` does. A ref that is a branch also leaves `refs/remotes/origin/<ref>`, as it does today: `git remote add` configures `+refs/heads/*:refs/remotes/origin/*`, and git updates that remote-tracking ref whenever it fetches the branch. Governs R3, R4, R5, R7.
- KTD2. **The refspec names `refs/heads/<base>`, never the bare name.** A tag or a commit SHA as `base` then matches no branch on the server, and git fails the fetch (R7) without the checkout telling names apart itself. The leading `+` lets a remote-tracking ref that already exists move, though in a fresh clone none does. Governs R4, R7.
- KTD3. **`base` gets `ref`'s argument check, with its own reason.** The predicate that refuses a `ref` starting with `-` or holding `:`, `*`, whitespace or NUL moves into one helper that both fields use, and a refused `base` says `base is a branch`. Inside `refs/heads/<base>` a leading `-` can't act as an option, but refusing it keeps the two fields' rules the same. A `base` of another type than a string is refused the same way. Governs R2.

### Assumptions

- GitHub serves `git fetch` of a branch without `--depth` and of any reachable commit SHA. Both are standard behavior of its smart HTTP server today.

---

## Implementation Units

### U1. Read `base` from the context

**Goal:** `readSettings` reads an optional `base` and refuses one that would reach git as an option or a refspec.

**Requirements:** R1, R2; KTD3.

**Dependencies:** none.

**Files:**

- `packages/workflows/git/checkout/settings.ts`
- `packages/workflows/tests/unit/git/checkout/settings.test.ts`

**Approach:**

- `Settings` gains an optional `base`, absent when the context has none.
- The `ref` check becomes a helper both fields call. Each field keeps its own reason: `ref is a commit, a branch or a tag`, `base is a branch`.
- The doc comment above `readSettings` lists `base` with the other fields.

**Patterns to follow:** the existing `test.each` refusal tables in `settings.test.ts`, at the top level with no `describe`, as the Tests section of AGENTS.md requires for Stryker.

**Test scenarios:**

- `readSettings` takes `base: "main"` and returns it in the settings.
- `readSettings` leaves `base` out of the settings when the context has none.
- Covers AE5. `readSettings` refuses `base` as `''`, `7`, `null`, `'--upload-pack=touch'`, `'-main'`, `'main:refs/heads/x'`, `'refs/heads/*'`, `'main other'`, `'main\nother'`, `'main\tother'` and `'main\0'`, each with the reason `base is a branch`.
- `readSettings` still refuses each refused `ref` with the `ref` reason, unchanged.

**Verification:** the unit suite passes at 90% on `settings.ts`, and every existing settings test passes unchanged.

### U2. Fetch the base with the ref, with full history

**Goal:** with `base` set, the clone holds both histories and `origin/<base>`; without it, nothing changes.

**Requirements:** R3, R4, R5, R6, R7, R8; KTD1, KTD2.

**Dependencies:** U1.

**Files:**

- `packages/workflows/git/checkout/checkout.ts`
- `packages/workflows/tests/repository.ts`
- `packages/workflows/tests/integration/git/checkout/checkout.test.ts`

**Approach:**

- `clone` builds its list of git commands from the settings. With a `base`, the base's fetch comes before the ref's fetch and the ref's fetch drops `--depth=1`. Without one, the list stays as today.
- Every command still runs under the one deadline and goes through the same loop, so R8 and the exit codes need no new code.
- The comment above `checkout` describes both fetches.
- In `tests/repository.ts`, `main` gets one more commit after `feature` branches off. The commit writes a new file and leaves `file.txt` at `second`, so every existing test still finds the same contents. `served` also exposes `main`'s tip and the moved commit, if the new tests need them.

**Execution note:** start with AE1's failing integration test against the moved base, before changing `checkout.ts`.

**Patterns to follow:** the tests in `checkout.test.ts` that run `git(workspace, …)` on the clone to check what it holds, and `run()` with a context.

**Test scenarios:**

- Covers AE1. With `ref: "feature"` and `base: "main"`, `git log --format=%H origin/main..HEAD` lists only `feature`'s commit.
- Covers AE1. With `ref: "feature"` and `base: "main"`, `git diff --name-only origin/main...HEAD` lists only `file.txt`, not the file `main`'s newer commit added.
- With `base: "main"`, `git rev-parse origin/main` is `main`'s tip.
- With `base: "main"`, HEAD is `feature`'s commit and stays detached (R5).
- With `base: "main"`, `git rev-list --count HEAD` counts every commit behind `feature`, not 1 (R3).
- With `ref: "feature"` and `base: "main"`, `git for-each-ref` lists exactly `refs/remotes/origin/feature` and `refs/remotes/origin/main`, and `git tag` lists nothing (R3, KTD1).
- Covers AE3. With `ref: "main"` and `base: "main"`, the checkout exits with 0, and the log and the diff against `origin/main` are empty.
- With `ref` a commit SHA (`served.first`) and `base: "main"`, the checkout exits with 0 and HEAD is that commit.
- Covers AE4. With `base: "release"`, a branch the server lacks, the checkout exits with git's nonzero code and the workspace holds no `file.txt`.
- Covers AE4. With `base: "v1"`, which the test repository has only as a tag, the checkout exits with git's nonzero code.
- Covers AE2. Without `base`, the existing test `checkout fetches only the ref, with no history behind it` passes unchanged.
- With `base` set and a `CHECKOUT_TIMEOUT_MS` the fetches outlast, the checkout resolves `timedOut`, as the existing timeout test does without `base`.

**Verification:** the integration suite passes at 90% on `checkout.ts`, and every existing checkout and Taskfile test passes unchanged.

### U3. Document `base`

**Goal:** whoever writes a context for `git/checkout` or `sextou/development` finds `base` where the other fields are listed.

**Requirements:** R9.

**Dependencies:** U2.

**Files:**

- `packages/workflows/git/checkout/Taskfile.yml`
- `packages/workflows/sextou/development/Taskfile.yml`
- `AGENTS.md`

**Approach:**

- The header of `git/checkout/Taskfile.yml` lists `base`: a branch, fetched with the ref, both with full history, kept as `origin/<base>`.
- The header of `sextou/development/Taskfile.yml` adds `base` to the fields `git/checkout` clones.
- In AGENTS.md, the `git/checkout/` sentence in Architecture names `base` and the full fetch it brings, and the Structure line for `checkout.ts` stops saying only "a shallow fetch of the ref".

**Test expectation:** none — comments and documentation only.

**Verification:** the three texts state what R1–R7 and KTD1 say, with no other claim.

---

## Verification Contract

| Gate            | Command                                            | Passes when                                                                                                                            |
| --------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Unit            | `pnpm --filter @sextou/workflows test:unit`        | every test passes, every file it answers for at 90%                                                                                    |
| Integration     | `pnpm --filter @sextou/workflows test:integration` | every test passes, every file it answers for at 90%; needs `task` (go-task) on the PATH, or its Taskfile tests skip and coverage fails |
| Mutation        | `pnpm --filter @sextou/workflows test:mutation`    | Stryker's score is at least 80%                                                                                                        |
| Lint and format | `pnpm lint`                                        | no finding                                                                                                                             |
| Gates           | `pnpm exec oxlint -c .oxlintrc.gates.json .`       | no finding                                                                                                                             |
| Types           | `pnpm typecheck`                                   | no error                                                                                                                               |

A mutant that changes no behavior gets a `// Stryker disable next-line <mutator>: <reason>` comment, never a lower floor.

## Definition of Done

- Every R1–R9 holds, and AE1–AE5 each have a passing test, or a documentation line for R9.
- Every existing test in `packages/workflows` passes without a changed expectation.
- Every gate in the Verification Contract passes.
- No code from an abandoned approach is left in the diff.
