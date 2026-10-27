---
name: run-runner
description: Start, run, smoke-test, watch and stop the sextou runner (@sextou/runner, apps/runner) against a server. Use when asked to run or start the runner, see it claim, heartbeat and complete a task, try a cancel or a lost lease end to end, check that a runner or runners-procedure change works against a real server, or run its tests.
---

The runner is a Node process that calls the server's `runners` procedures (claim, heartbeat, complete), downloads the repository each claim names from GitHub and runs its Taskfile with go-task, handing it the task's context as JSON in `CONTEXT`, an empty folder for its work in `WORKSPACE` and the path where it may write the tasks that follow it in `TASKS_FILE`, sends that file's text with the completion of a run that succeeded, and logs one JSON record per step and per line of output. Each claim names the Taskfile in the task's `uses`, `owner/name/path/to/Taskfile.yml@<sha>`, which the server hands over split. The driver's tasks name this repository's `tasks/hello-world/` at the commit that added it (now `packages/workflows/hello-world/`), which prints `hello world` with Python, reads neither variable and runs for 2 s. A task created without a `uses` is claimed and `completed` as `failed`, `reason: the task names nothing to run: it has no uses`, with nothing downloaded. It needs go-task as `task` on the PATH, or `SEXTOU_RUNNER_TASK_BIN`, tar as `tar` on the PATH, or `SEXTOU_RUNNER_TAR_BIN`, network to github.com, and python3 for hello-world. An agent drives it with `.claude/skills/run-runner/driver.mjs`: `smoke` runs the whole flow against a server of its own, and `start`/`wait`/`stop` run the runner in the background against a server the `run-server` skill started, while `wait` blocks on a log record. The driver needs nothing but Node.

All paths below are relative to `apps/runner/`. Run `pnpm` commands from the repository root.

## Setup

```bash
pnpm install          # from the repository root
```

No variable is required; `.env.example` lists each `SEXTOU_RUNNER_*` setting with its default. Only needed for `start --build`, which runs the production bundle:

```bash
pnpm --filter @sextou/runner build   # -> dist/runner.mjs
```

## Run (agent path)

One command checks the whole flow, against a server it starts through the `run-server` driver (its own state file, a free port, a 600 ms lease) and stops afterwards:

```bash
node .claude/skills/run-runner/driver.mjs smoke
```

It prints one `ok`/`FAIL` line per step and exits 1 at the first wrong one, in about 7 s. It touches neither driver's state file, so it runs beside a server or runner you started, and it drops every `SEXTOU_*` variable from your shell but `SEXTOU_RUNNER_TASK_BIN` and `SEXTOU_RUNNER_TAR_BIN`, so an exported setting doesn't change it. A step that throws fails the smoke and stops what it started. Steps:

1. The runner against a port nothing listens on logs `claim failed`, `failure: no_answer`.
2. Server listening, runner started.
3. A task created with hello-world's `uses` is `claimed`, gets a `heartbeat`, and is `completed`, `outcome: succeeded`, with an `output` record `hello world` from its Taskfile.
4. A second task is claimed, cancelled through `tasks.cancel` while its Taskfile runs (answers `running`), and `completed`, `outcome: cancelled`.
5. `runners.claim` finds nothing left.
6. A task whose `uses` names `packages/workflows/examples/create-tasks/`, which writes its context to `TASKS_FILE`, with a context of two tasks under an assignee no runner serves, `second` waiting for `first`, is `completed`, `outcome: succeeded`, with one `task created` record per task (`key`, `id`); `runners.claim` on their assignee returns `first`, then nothing, as `second` waits for it.
7. The runner stops on SIGTERM with `stopped` as its last record.

Step 6 names create-tasks at `d89b3947f3f428cb1b93bf984f98bb1b2bc345a4`, the commit that added it, as hello-world's tasks name the commit that added hello-world. It fails with `reason: download: HTTP 404` until GitHub has that commit, and a rebase of its branch before the merge gives the commit a new SHA, which the pin must name again.

To drive it step by step, start a server with the `run-server` skill, then the runner. `start` takes the server's URL from `--server <url>`, else `SEXTOU_RUNNER_SERVER_URL`, else the server `run-server` started:

```bash
S=../server/.claude/skills/run-server/driver.mjs
node $S start
node .claude/skills/run-runner/driver.mjs start          # from source (tsx); --build runs dist/runner.mjs; prints { pid, log, name, assignees, serverUrl }
node $S call tasks.create '{"title":"Say hi","kind":"task","priority":2,"assignee":"run-runner","createdBy":"me","uses":"thatsnotmynameio/sextou/tasks/hello-world/Taskfile.yml@87dfc7f4f839d6e334ab1a1cdf6494c62499d9ff"}'
node .claude/skills/run-runner/driver.mjs wait claimed
node .claude/skills/run-runner/driver.mjs wait completed
node .claude/skills/run-runner/driver.mjs log
node .claude/skills/run-runner/driver.mjs stop
node $S stop
```

| command                                     | what it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start [--build] [--server <url>]`          | Spawns `node --import tsx src/main.ts`, or `node dist/runner.mjs` with `--build`, detached, waits for the `started` record and prints `{ pid, log, name, assignees, serverUrl }`. Its defaults: name and assignee `run-runner`, `SEXTOU_RUNNER_POLL_MS=500`, `SEXTOU_RUNNER_LOG_LEVEL=debug`. Any `SEXTOU_RUNNER_*` you export wins. It ignores `apps/runner/.env`. On an invalid variable it prints the runner's error record and exits 1.                                                             |
| `wait <msg> [--task <id>] [--timeout <ms>]` | Prints the first log record whose `msg` is `<msg>` (and whose `taskId` is `<id>`), or exits 1 after 15 s or once the runner exited. `--timeout` takes milliseconds only. The messages: `started`, `claim failed`, `claimed`, `output` (with `stream` and `line`), `heartbeat` (debug), `heartbeat failed`, `lease lost`, `complete failed`, `complete refused`, `completed` (with the `outcome` and `reason` the server recorded), `task created` (with `key` and `id`, the created task's), `stopped`. |
| `log`                                       | Prints the runner's log, one JSON record per line.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `stop`                                      | SIGTERM, waits up to 10 s, then SIGKILL. The log stays in its `/tmp/sextou-runner-*` folder.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `smoke`                                     | The flow above, against its own server.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

The running runner's state is in `/tmp/sextou-run-runner/state.json` (`$RUN_RUNNER_STATE` overrides it). One runner per state file: `start` refuses while one runs.

To see a task reopen after the runner stops mid-run:

```bash
export SEXTOU_SERVER_LEASE_MS=1500 SEXTOU_SERVER_LEASE_SWEEP_MS=200 SEXTOU_SERVER_MAX_ATTEMPTS=2
node $S start
node .claude/skills/run-runner/driver.mjs start
node $S call tasks.create '{"title":"A","kind":"task","priority":2,"assignee":"run-runner","createdBy":"me","uses":"thatsnotmynameio/sextou/tasks/hello-world/Taskfile.yml@87dfc7f4f839d6e334ab1a1cdf6494c62499d9ff"}'
node .claude/skills/run-runner/driver.mjs wait claimed   # "attempt":1
node .claude/skills/run-runner/driver.mjs stop
sleep 3
node .claude/skills/run-runner/driver.mjs start
node .claude/skills/run-runner/driver.mjs wait claimed   # the same task, "attempt":2
node .claude/skills/run-runner/driver.mjs wait completed --timeout 15000
node .claude/skills/run-runner/driver.mjs stop
node $S stop
```

To see the runner ride out a server restart, give the server a fixed port and a lease longer than the restart (verified with `SEXTOU_SERVER_PORT=4391`, `SEXTOU_SERVER_DATA_DIR` set to a folder and kept, a 6000 ms lease): stop the server after `claimed` and start it again at once. The task completes as `succeeded`. A call that reaches the server while it is down logs `heartbeat failed` or `complete failed` with `no_answer` and is sent again. With a lease shorter than the restart, the runner logs `lease expired` and drops the task.

## Run (human path)

```bash
SEXTOU_RUNNER_SERVER_URL=http://127.0.0.1:4310 pnpm --filter @sextou/runner dev   # from source; JSON lines on stdout; Ctrl-C logs stopped and exits
pnpm --filter @sextou/runner build && pnpm --filter @sextou/runner start          # the bundle, dist/runner.mjs, the same way
```

Both read `apps/runner/.env` when it exists.

Its name, and so its only assignee, is the machine's hostname unless `SEXTOU_RUNNER_NAME` says otherwise, and heartbeats aren't logged at the default level. An agent should use the driver instead.

## Test

```bash
pnpm --filter @sextou/runner test:unit         # 100% coverage
pnpm --filter @sextou/runner test:integration  # main.ts against the server started as a child process, taskfile.ts and download.ts, against a tarball served on localhost; needs go-task and tar
pnpm --filter @sextou/runner test:mutation     # Stryker, about 1.5 min, fails below 80%
```

## Gotchas

- **A task only reaches a runner that serves its assignee.** The driver's runner serves `run-runner`, so create tasks with `"assignee":"run-runner"`. With `pnpm dev`, the assignee is the hostname.
- **The server's URL is fixed when the runner starts.** `run-server`'s `start` listens on a new free port each time, so a runner left running keeps calling the old port after a server restart, and logs `heartbeat failed` / `complete failed` with `no_answer` forever. Restart the runner too, or give the server a fixed `SEXTOU_SERVER_PORT`.
- **Stopping the runner mid-run doesn't complete the task.** The server's sweep ends the attempt once its lease runs out: with the server's default `SEXTOU_SERVER_MAX_ATTEMPTS=1` the task fails, so set it to 2 or more to see it claimed again.
- **The smoke shows the context reaching a Taskfile only through create-tasks.** hello-world reads no `CONTEXT`; create-tasks writes it to `TASKS_FILE`, so the tasks its run creates are the context's. `main.test.ts` checks it end to end, serving a Taskfile that prints `{{.CONTEXT | q}}`.
- **A run's tasks file is read only when the run succeeded**, and only a regular file no larger than `SEXTOU_RUNNER_MAX_TASKS_FILE_BYTES` (1 MiB): a link, a FIFO or a larger file completes the task as `failed`, `reason: tasks file: …`. A file the server refuses logs `completed` with `outcome: failed` and the server's reason, though the runner sent `succeeded`: `completed` carries what the server recorded, as `cancelled` when a cancel reached it first.
- **`heartbeat` records are debug.** The driver's `start` and `smoke` log at debug; `pnpm dev` doesn't, unless `SEXTOU_RUNNER_LOG_LEVEL=debug`.
- **The runner heartbeats every third of the lease the server answers**, not of anything the runner sets. To see several heartbeats in hello-world's 2 s run, shorten `SEXTOU_SERVER_LEASE_MS`.
- **The driver kills the right process because it skips `pnpm` and `tsx`.** It runs `node --import tsx src/main.ts`, or `node dist/runner.mjs`, one process, so its pid is the runner's. Under `pnpm dev` or `pnpm start`, the pid you hold is a wrapper.
- **`start --build` runs the bundle you built last.** Run `pnpm --filter @sextou/runner build` again after a change, or it runs the old code.
- **`pnpm dev` prints `.env not found. Continuing without it.` twice.** That's tsx's `--env-file-if-exists`, not an error.
- **Lint scans this folder.** `lint / gates` refuses `console` outside test files, so the driver writes through `process.stdout`/`process.stderr`. Run `pnpm exec oxlint -c .oxlintrc.gates.json .` and `pnpm exec oxfmt --check .` after editing it.

## Troubleshooting

- **`No dist/runner.mjs`** on `start --build`: run `pnpm --filter @sextou/runner build` first.
- **`No server URL: pass --server <url>, …`**: no `--server`, no `SEXTOU_RUNNER_SERVER_URL`, and no server from `run-server`. Start one with `node ../server/.claude/skills/run-server/driver.mjs start`.
- **`The runner did not start.` followed by `Invalid SEXTOU_RUNNER_…`**: an exported variable has a bad value. The record names it and what it expects.
- **`The runner did not start.` followed by `SEXTOU_RUNNER_TASK_BIN is not go-task`**: `task` isn't on the PATH, or is another program (Taskwarrior). The record's `reason` says which. Install go-task, or export `SEXTOU_RUNNER_TASK_BIN` with its name or path.
- **`The runner did not start.` followed by `SEXTOU_RUNNER_TAR_BIN does not run`**: no `tar` on the PATH, or one that fails `--version`. The record's `reason` says which. Install tar, or export `SEXTOU_RUNNER_TAR_BIN` with its name or path.
- **`completed` with `reason: download: …`**: the runner couldn't download the claim's repository: `fetch failed` without network to `SEXTOU_RUNNER_GITHUB_URL`, `HTTP 404` for a commit or repository GitHub doesn't have, `timeout` past `SEXTOU_RUNNER_DOWNLOAD_TIMEOUT_MS`. The task's Taskfile didn't run.
- **`completed` with `reason: exit code 127`**, and an `output` record `python3: not found`: hello-world's Taskfile runs `python3`, which the machine lacks.
- **`No claimed record.`**: the task's assignee isn't one the runner serves, or the runner's server isn't the one you created the task on. Compare `start`'s `assignees` and `serverUrl` with the task.
- **`Already running: pid …`**: a runner from an earlier `start` is still up. Run `stop`, or set `RUN_RUNNER_STATE` to another path to run a second one.
