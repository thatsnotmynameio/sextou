---
title: CI setup actions - Plan
type: refactor
date: 2026-10-28
topic: ci-setup-actions
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# CI setup actions - Plan

## Goal Capsule

- **Objective:** A change to how the checks set up Node, pnpm or go-task is made in one place, and Dependabot keeps the actions pinned there current.
- **Means:** two local composite actions in `.github/actions/`, `pnpm` and `go-task`, called by the jobs of `.github/workflows/checks.yml` (Key Decisions, KTD1).
- **Product authority:** issue #121, narrowed in the brainstorm to the composite actions. The reusable `level.yml` and `mutation.yml` the issue describes are not active scope.
- **Open blockers:** none.
- **Stop conditions:** stop and ask when a check would have to change its name, its `needs` or its permissions to make an action work, since R5 rules that out.
- **Execution profile:** CI configuration only. No source or test code changes, and the proof is the pull request's own Checks run (Verification Contract).
- **Who finishes:** `ce-work` implements U1 to U4 on this branch and opens one pull request for issue #121.

---

## Product Contract

### Summary

`checks.yml` keeps its chain and its jobs, and each job calls the `pnpm` and `go-task` actions instead of writing their steps out. Each action holds its own version, and Dependabot watches both. The check names, the levels' shared anchor and what runs for which package stay as they are.

### Problem Frame

`checks.yml` writes the same setup out in several places. Checkout, setup-node, pnpm, the store under `$RUNNER_TEMP` and `pnpm install` appear in `gates`, in the levels' anchor and in `mutation`. `packages` repeats setup-node and pnpm without the install. The go-task install, with its download and checksum, appears in the anchor and in `mutation`. A new pnpm version, a new pin or a new go-task release has to be made in each copy, and a copy left behind breaks a check without anyone noticing.

The levels themselves are not repeated: `unit`, `integration` and `component` already share one step list through a YAML anchor.

### Requirements

**Setup in one place**

- R1. A local composite action, `pnpm`, sets up Node from `.node-version`, pnpm at the pinned version and the store and cache under `$RUNNER_TEMP`, then runs `pnpm install --frozen-lockfile --ignore-scripts`.
- R2. `packages`, which needs pnpm's filter but no install, gets pnpm from the same action and skips the install.
- R3. A local composite action, `go-task`, downloads the pinned go-task release, checks it against its checksum and puts `task` on the PATH. The version and the checksum live in that action.
- R4. `gates`, `packages`, the levels' anchor and `mutation` call the actions instead of writing their steps out. Each job checks the repository out itself before the call, since a local action needs the checkout.

**What stays as it is**

- R5. The chain stays as it is, with each job's `needs`, `if`, permissions, timeout and matrix, the levels' anchor, and the packages each level and mutation run for. The checks keep their names: `lint / gates`, `packages`, `<package> / <level>` and `<package> / mutation`.
- R6. The organization's pnpm policy, the `pnpm_config_*` settings, stays in `checks.yml`'s `env`, and the actions' steps run under it.
- R7. go-task is still installed only for the integration levels of `runner` and `workflows` and for their mutation runs.

**Keeping the pins current**

- R8. Dependabot updates the actions pinned inside `.github/actions/` as it updates the workflows' pins.

**Documentation**

- R9. AGENTS.md's CI section names the two actions and what each sets up, and says that the runner's and the workflows' jobs install go-task. The comments in `checks.yml` still describe what the file does.

### Key Decisions

- **Composite actions only, no reusable workflow.** (session-settled: user-directed — chosen over a reusable `level.yml` called by the three levels, with or without a `mutation.yml`: the anchor already writes the levels' steps once, and a called workflow would rename the checks, lose the caller's `env` and leave `id-token: write` on the calling jobs.) Governs R4, R5.
- **Each action holds its own version; the pnpm policy stays in the workflow.** After the change only the actions read the pnpm and go-task versions and go-task's checksum. pnpm itself reads the policy on every run, the tests included, and the policy mirrors the organization's `typescript.yml`. Governs R1, R3, R6.
- **The Dependabot change is part of this work.** Dependabot's `directory: '/'` watches `.github/workflows` and a root `action.yml`, not `.github/actions/`. Without the change, the pins inside the actions stop getting updates and nothing shows it. Governs R8.

### Success Criteria

- The pull request's own Checks run passes with the same check names as on `main`. A change under `.github/` runs every package's levels and mutation in full, so that run exercises every job that calls the actions.

### Scope Boundaries

- A reusable `level.yml` or `mutation.yml`, which the Key Decisions reject.
- Moving the levels, the lint gates or mutation to the organization's `typescript.yml`.
- Other workflows: none of them sets up Node or pnpm.
- Changing any version, pin or setting of the pnpm policy.
- A local linter for workflows and actions (actionlint) or a harness that runs them: considered and not built. The pull request's Checks run and zizmor already exercise every changed line. A workflow change that reaches `main` broken would change that call.

### Sources / Research

- `.github/workflows/checks.yml`: the gates setup at lines 78-95, the packages setup at 117-128, the levels' anchor at 217-259, mutation's setup and go-task at 322-352.
- `.github/dependabot.yml`: the github-actions entry with `directory: '/'`.
- Dependabot options reference: `directory: '/'` covers `/.github/workflows` and a root `action.yml`, and `directories` "supports globbing", without saying for which ecosystems. https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference
- thatsnotmynameio/github-actions' `zizmor.yml` at `3615f1d6` (v0.4.0), which `security-main.yml` calls and the ruleset runs on pull requests: it runs zizmor on `.` and counts any `action.yml` as input, so it audits `.github/actions/`.
- Issue #121, which proposed the reusable level workflow and the two actions, and rejected `workflow_run` and one workflow per check.

---

## Planning Contract

Product Contract preservation: changed: the second Key Decision and R1, R6 and R9. pnpm's version moves into its action beside go-task's, R6 names the policy as the `pnpm_config_*` settings, and R9 corrects AGENTS.md's go-task sentence. The user confirmed both at the plan's scoping synthesis. The brainstorm's Outstanding Questions are resolved by KTD2 to KTD4 and removed. KTD6 came from document review and the user chose it; it changes how R1 and R3 are met, not what they require.

### Key Technical Decisions

- KTD1. **One folder per action, `.github/actions/pnpm/action.yml` and `.github/actions/go-task/action.yml`. The `go-task` action takes no input, and the `pnpm` action takes one, `install`.** `install` is `'true'` by default, and `packages` passes `false`, which skips the install step (R2). An action's input arrives as a string, so that step compares it as one, `if: inputs.install == 'true'`: a bare `if: inputs.install` would read `'false'` as true and install anyway. The input reaches the steps only through `if:`, never inside a `run:` script, so zizmor's template-injection audit has nothing to flag. Every `run:` step in an action sets `shell: bash`, which a composite action requires.
- KTD2. **The versions become constants inside the actions, and `PNPM_VERSION`, `GO_TASK_VERSION` and `GO_TASK_SHA256` leave `checks.yml`'s `env`.** (session-settled: user-approved — chosen over keeping `PNPM_VERSION` in the workflow's `env`: once every job goes through the action, nothing else reads it.) pnpm's version is the `version:` the action hands `pnpm/action-setup`. go-task's version and checksum are the `env:` of the action's install step, with the comment that names where the checksum comes from. Governs R1, R3.
- KTD3. **The `pnpm_config_*` policy stays in the workflow's `env`, and the actions read none of it themselves.** A composite action's `run:` steps run as steps of the calling job, with the job's environment, which includes the workflow's `env`. The workflow `env` reference describes it as "available to the steps of all jobs in the workflow". The run's log shows it: each step's header lists its environment. Governs R6.
- KTD4. **Dependabot's github-actions entry lists its folders under `directories`, one each: `/`, `/.github/actions/pnpm` and `/.github/actions/go-task`.** (session-settled: user-approved — chosen over one glob `/.github/actions/*`: the docs don't say a glob works for github-actions.) A comment beside the list says that a new action under `.github/actions/` needs its folder added. Governs R8.
- KTD5. **Each caller keeps its own `if:` on the step that calls `go-task`.** The anchor's condition (`runner` or `workflows`, `integration` level) and mutation's (`runner` or `workflows`) stay as they are, so the action itself installs unconditionally. Governs R7.

- KTD6. **No action writes `$GITHUB_ENV` or `$GITHUB_PATH`.** (session-settled: user-directed — chosen over keeping both writes and ignoring zizmor's `github-env` audit for the two action files in `.github/zizmor.yml`: no step can then change what the steps after it run with, and no rule hides a later real finding.) zizmor 1.30.1, the version the organization's workflow pins, audits a workflow's writes to those files only under a `pull_request_target` or `workflow_run` trigger. It flags every such write in a composite action as High, since an action can't know its caller, so moving `checks.yml`'s writes into the actions as they are would raise new alerts. Instead:
  - `pnpm_config_store_dir` and `pnpm_config_cache_dir`, under `${{ runner.temp }}`, are the `env:` of the install step alone. pnpm reads them when it installs, and the commands later in the job (`pnpm run`, `pnpm exec`) don't read the store.
  - go-task extracts into `$HOME/.local/bin`, which the Ubuntu runner image puts on the PATH (actions/runner-images, `images/ubuntu/scripts/build/install-python.sh`). The action creates the folder, then fails unless `command -v task` resolves to the binary it extracted.

  Governs R1, R3.

### Risks & Dependencies

- **The policy might not reach pnpm inside the action.** If KTD3's inheritance were wrong, `pnpm install` would still succeed under pnpm's defaults and no check would fail. U2's verification reads the policy in the install step's header before the change is called done.
- **A later pnpm command might want the store the install used.** With the store folder set on the install step alone (KTD6), a command that reads the store later in the job would look in pnpm's default folder. None of the job's later commands reads it, and one that did would fail its check with an error naming the store, not pass quietly.
- **Dependabot shows a misconfigured directory only after merge.** An entry it can't read shows up on the repository's Dependabot page, not in the pull request. U3's verification reads that page after merge.

---

## Implementation Units

### U1. The go-task action

**Goal:** go-task's download, checksum and PATH setup live in one action that the anchor and mutation call.

**Requirements:** R3, R4, R7; KTD1, KTD2, KTD5, KTD6.

**Dependencies:** none.

**Files:**

- `.github/actions/go-task/action.yml` (create)
- `.github/workflows/checks.yml` (modify: the anchor's and mutation's go-task steps, the `env` block)

**Approach:**

1. Create the action from the current go-task step: the same `curl`, `sha256sum -c` and `tar` lines, with `GO_TASK_VERSION` and `GO_TASK_SHA256` as the step's `env:` and the comment that says where the checksum comes from. `tar` extracts `task` into `$HOME/.local/bin` instead of writing `$GITHUB_PATH`, and the step ends by failing unless `command -v task` names that file (KTD6).
2. Replace both go-task steps in `checks.yml` with a step that keeps its `name:` and `if:` and `uses: ./.github/actions/go-task`.
3. Remove `GO_TASK_VERSION` and `GO_TASK_SHA256`, with their comment, from the workflow's `env`.

**Patterns to follow:** the comment style of `checks.yml` (each step's why in a comment above it), and its SHA pins with the version as a comment.

**Test expectation:** none. This is CI configuration with no unit to test, and the Verification Contract's Checks run is the proof.

**Verification:** in the pull request's Checks run, `runner / integration`, `workflows / integration`, `runner / mutation` and `workflows / mutation` pass and their logs show the action putting `task` on the PATH. No other level runs the action.

### U2. The pnpm action

**Goal:** Node, pnpm, the store and the install live in one action that every job of `checks.yml` calls.

**Requirements:** R1, R2, R4, R5, R6; KTD1, KTD2, KTD3, KTD6.

**Dependencies:** none (independent of U1, and both touch `checks.yml`).

**Files:**

- `.github/actions/pnpm/action.yml` (create)
- `.github/workflows/checks.yml` (modify: `gates`, `packages`, the anchor, `mutation`, the `env` block and its comment)

**Approach:**

1. Create the action: setup-node from `.node-version` with `package-manager-cache: false`, `pnpm/action-setup` at the pinned version, then `pnpm install --frozen-lockfile --ignore-scripts`, which runs only when `install` is `'true'` and takes the store and cache folders under `${{ runner.temp }}` as its own `env:` (KTD6). The action has no store step. Copy the SHA pins and their version comments as they are.
2. In `gates`, the anchor and `mutation`, replace the setup-node, pnpm, store and install steps with one step that uses `./.github/actions/pnpm`, after the job's checkout.
3. In `packages`, replace setup-node and pnpm with the action, passing `install: false`. Keep its checkout's `fetch-depth: 2` and the comment that says the step installs nothing.
4. Remove `PNPM_VERSION` from the workflow's `env`, and reword the block's comment so it describes only the `pnpm_config_*` policy.

**Patterns to follow:** the comments `checks.yml` puts on the pnpm steps (why the store lives under `$RUNNER_TEMP`, why `packages` installs nothing).

**Test expectation:** none. This is CI configuration with no unit to test, and the Verification Contract's Checks run is the proof.

**Verification:**

- Every check of the pull request's Checks run passes under the same name as on `main`.
- In one level job's log, the expanded `pnpm install` step's header lists the `pnpm_config_*` variables (KTD3).
- `packages` still prints its matrix, and its log shows the action's install step skipped.

### U3. Dependabot watches the actions

**Goal:** Dependabot updates the SHA pins inside both actions.

**Requirements:** R8; KTD4.

**Dependencies:** U1, U2 (the folders exist).

**Files:**

- `.github/dependabot.yml` (modify: the github-actions entry)

**Approach:**

1. Replace `directory: '/'` with `directories` listing `/`, `/.github/actions/pnpm` and `/.github/actions/go-task`.
2. Add a comment that a new action under `.github/actions/` needs its folder listed there.
3. Leave the schedule, cooldown, commit message and group as they are, so the actions' updates land in the same weekly `ci(deps)` pull request as the workflows'.

**Test expectation:** none. Dependabot reads this file only on the default branch.

**Verification:**

- zizmor's Dependabot audits on the pull request report nothing new.
- After merge, the repository's Dependabot page lists the three directories under github-actions without an error.

### U4. AGENTS.md's CI section

**Goal:** the CI section says where the checks' setup lives and which jobs install go-task.

**Requirements:** R9.

**Dependencies:** U1, U2, U3.

**Files:**

- `AGENTS.md` (modify: the `checks.yml` bullet of the CI section)

**Approach:**

1. In the tests bullet, after the sentence about the YAML anchor, add one sentence: every job sets up Node and pnpm through `.github/actions/pnpm`, and the go-task install is `.github/actions/go-task`. Each action holds its version, and Dependabot watches both folders.
2. Change "only the runner's jobs install go-task" to name the runner's and the workflows' integration and mutation jobs.

**Patterns to follow:** the section's prose, one long bullet per workflow, plain sentences without lists.

**Test expectation:** none. Documentation only.

**Verification:** the bullet matches U1 to U3 as merged, and no other sentence in AGENTS.md says where `checks.yml` sets up pnpm or go-task.

---

## Verification Contract

| Gate            | Command or place                                                                                 | Proves                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Lint and format | `pnpm lint`                                                                                      | oxfmt and oxlint pass on the changed files, as the pre-commit hook runs them                                   |
| Pre-push        | `pnpm typecheck`, `pnpm test:unit` (the `pre-push` hook)                                         | nothing outside CI changed                                                                                     |
| Checks run      | the pull request's `Checks` workflow                                                             | every job that calls an action runs and passes, every package in full, because `.github/` changed (R4, R5, R7) |
| Check names     | `gh pr checks` against the names of `main`'s latest Checks run                                   | R5's names are unchanged                                                                                       |
| Policy          | the expanded `pnpm install` step in one level job's log                                          | the `pnpm_config_*` variables reach the action (R6, KTD3)                                                      |
| zizmor          | `tnmn.io: zizmor` on the pull request                                                            | the actions and `dependabot.yml` raise no new finding                                                          |
| No setup left   | a search of `checks.yml` for `setup-node`, `action-setup`, `pnpm install` and `task_linux_amd64` | no setup step is written out (R4)                                                                              |

---

## Definition of Done

- U1 to U4 are merged in one pull request for issue #121, titled as a Conventional Commit (`ci: …`).
- Every gate of the Verification Contract passed on the pull request's last commit.
- `checks.yml`'s `env` holds only the `pnpm_config_*` policy and its comment.
- No step, comment or variable left over from an abandoned approach remains in the diff.
- After merge: the repository's Dependabot page lists the three github-actions directories without an error (U3).
