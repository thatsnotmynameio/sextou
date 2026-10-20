---
title: bd serve won't start outside a git repository
date: 2026-10-20
category: integration-issues
module: packages/beads
problem_type: integration_issue
component: infrastructure
severity: high
symptoms:
  - 'bd serve exits with 1: cannot resolve workspace context: cannot determine repository root: not a git repository: exec: "git": executable file not found in $PATH'
  - 'With git on the PATH but the working folder outside a repository, the same error ends in exit status 128'
  - bd init and bd config set succeed in the same folder, so the failure first shows at the bd serve step
root_cause: incomplete_setup
resolution_type: code_fix
framework_version: beads 1.3.1
related_components:
  - tooling
tags: [beads, bd-serve, git, dolt, beads-dir, child-process, path]
retire_when: 'A beads release whose bd serve resolves its workspace from BEADS_DIR without git (check gastownhall/beads release notes and internal/beads/context.go buildRepoContext); retiring it also needs a bump of the pin in packages/beads/src/pins.ts'
---

# bd serve won't start outside a git repository

## Problem

sextou keeps each organization's beads configuration in its own data directory (`<data dir>/beads/default/.beads`, selected with `BEADS_DIR`), never in a user's repository. bd 1.3.1's `bd serve` refuses to start there: it needs its working folder to sit inside a git repository, and it needs a `git` binary to find that out. The plan assumed `BEADS_DIR` alone was enough, because `bd init` worked without git.

## Symptoms

- `bd serve --addr 127.0.0.1:<port> --auth-token-file <file>` exits with 1 and prints `Error: cannot resolve workspace context: cannot determine repository root: not a git repository: exec: "git": executable file not found in $PATH`, followed by its usage text.
- With `PATH=/usr/bin:/bin` and the folder outside any repository, the message ends in `exit status 128` instead.
- `bd init --server ... --init-if-missing` and `bd config set events-journal true` both exit 0 in the same folder with no PATH, so the failure first shows at the last start step.

## What Didn't Work

- **No PATH for the bd children.** The plan built every child's environment from scratch with no PATH, so that bd couldn't reach a git that might commit into a repository around the data directory. `bd init` was fine with that; `bd serve` was not.
- **git on the PATH alone.** Outside a repository, `git rev-parse` exits 128 and `bd serve` still refuses.
- **A `.beads/redirect` pointer.** Pointing `BEADS_DIR` at a pointer folder whose `.beads/redirect` names the real `.beads` still failed with the same `exec: "git"` error in this session's run with the real binaries. The cause was not traced: `buildRepoContext`'s redirect branch falls back to the folder's parent when git fails (`repoRootForBeadsDir`, `internal/beads/context.go:199-206` in gastownhall/beads v1.3.1), so the failure comes from a different git call on that path.
- **An environment variable.** beads' git package has no override for the repository root (no environment read in `internal/git/gitdir.go` of gastownhall/beads v1.3.1).

## Solution

Make the organization's folder an empty git repository of its own, require git on the server's PATH, and give the bd children a PATH holding only git's folder.

- The binaries step finds git on the PATH the server passes, and fails naming it when there is none: `packages/beads/src/platform.ts:40-56` (`findGit`), called from `packages/beads/src/start.ts:80`; the server passes `process.env.PATH` (`apps/server/src/main.ts:43`).
- The organization step runs `git init --quiet --template=` in `beads/default/` when it has no `.git`, before `bd init` (`packages/beads/src/organization.ts:30-39`). `--template=` copies no hooks, with system git and any other git alike.
- Every bd child gets `PATH` set to git's folder and nothing else from the server's environment (`packages/beads/src/child-env.ts:61`); `git init` gets the platform minimum (`HOME` set to the data directory's `dolt-home/`), so the user's git config isn't read.
- The test fake for bd refuses `serve` without a `.git` in its working folder, as the real one does (`packages/beads/src/test/fake-bd.ts:51`), so a regression shows in the unit suite.

Checked with the real bd 1.3.1 and Dolt 2.2.0: `bd serve` gets ready (200 on `/v0/beads/ready?limit=1` with the token, 401 without), a bead written through it lands in the events journal, and the repository stays empty. In that run the repository got no commit and no hook; the only change was `bd init` adding `[beads] role = maintainer` to its `.git/config` (`git config beads.role <role>` in bd's `cmd/bd/init.go`).

## Why This Works

`bd serve` resolves its workspace before it opens anything (`cmd/bd/serve.go:262-269` in gastownhall/beads v1.3.1), and that resolution runs `beads.GetRepoContext` (`internal/beads/context.go:104-153`). For a `.beads` that isn't redirected, it asks git for the repository's main root and fails with `cannot determine repository root` when git can't answer (`context.go:134-137`). An empty repository whose root is the organization's folder answers that question, and its root is the folder itself, so bd's later git calls (`rev-parse --show-toplevel`, `--git-common-dir`, `config --get beads.role`) stay inside the data directory instead of reaching a repository around it.

## Prevention

- When a beads pin changes, run the smoke from the plan's Verification Contract with the real binaries; the fakes only encode what 1.3.1 does.
- Downloading a portable git when the machine has none is #37. bd only runs read-only git queries at start (`rev-parse` and `config`), plus `git init` from sextou, so a portable git is enough; it must be on the PATH the bd children get, and `git init` must keep `--template=`.
- Don't drop the PATH from the bd children to tighten their environment: `bd serve` needs it for git.

## Related Issues

- #37: download a portable git when the machine has none.
- `.compound-engineering/artifacts/plans/2026-10-19-2030-feat-beads-engine-plan.md`: KD13 and R15 record the decision to require git.
