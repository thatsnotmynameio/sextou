---
name: run-runner
description: Start, run, smoke-test, watch and stop the sextou runner (@sextou/runner, apps/runner) against a server. Use when asked to run or start the runner, see it claim, heartbeat and complete a task, try a cancel or a lost lease end to end, check that a runner or runners-procedure change works against a real server, or run its tests.
---

The runner is a Node process that calls the server's `runners` procedures (claim, heartbeat, complete), runs the Taskfile each claim carries with go-task (the server answers a stub that writes `sextou stub` and runs for 2 s), and logs one JSON record per step and per line of output. It needs go-task as `task` on the PATH, or `SEXTOU_RUNNER_TASK_BIN`. An agent drives it with `.claude/skills/run-runner/driver.mjs`: `smoke` runs the whole flow against a server of its own, and `start`/`wait`/`stop` run the runner in the background against a server the `run-server` skill started, while `wait` blocks on a log record. The driver needs nothing but Node.

All paths below are relative to `apps/runner/`. Run `pnpm` commands from the repository root.

## Setup

```bash
pnpm install          # from the repository root
```

No build: the runner runs from source with tsx. No variable is required; `.env.example` lists each `SEXTOU_RUNNER_*` setting with its default.

## Run (agent path)

One command checks the whole flow, against a server it starts through the `run-server` driver (its own state file, a free port, a 600 ms lease) and stops afterwards:

```bash
node .claude/skills/run-runner/driver.mjs smoke
```

It prints one `ok`/`FAIL` line per step and exits 1 at the first wrong one, in about 7 s. It touches neither driver's state file, so it runs beside a server or runner you started, and it drops every `SEXTOU_*` variable from your shell but `SEXTOU_RUNNER_TASK_BIN`, so an exported setting doesn't change it. A step that throws fails the smoke and stops what it started. Steps:

1. The runner against a port nothing listens on logs `claim failed`, `failure: no_answer`.
2. Server listening, runner started.
3. A task is `claimed`, gets a `heartbeat`, and is `completed`, `outcome: succeeded`, with an `output` record `sextou stub` from its Taskfile.
4. A second task is claimed, cancelled through `tasks.cancel` while its Taskfile runs (answers `running`), and `completed`, `outcome: cancelled`.
5. `runners.claim` finds nothing left.
6. The runner stops on SIGTERM with `stopped` as its last record.

To drive it step by step, start a server with the `run-server` skill, then the runner. `start` takes the server's URL from `--server <url>`, else `SEXTOU_RUNNER_SERVER_URL`, else the server `run-server` started:

```bash
S=../server/.claude/skills/run-server/driver.mjs
node $S start
node .claude/skills/run-runner/driver.mjs start          # prints { pid, log, name, assignees, serverUrl }
node $S call tasks.create '{"title":"Say hi","kind":"task","priority":2,"assignee":"run-runner","createdBy":"me"}'
node .claude/skills/run-runner/driver.mjs wait claimed
node .claude/skills/run-runner/driver.mjs wait completed
node .claude/skills/run-runner/driver.mjs log
node .claude/skills/run-runner/driver.mjs stop
node $S stop
```

| command                                     | what it does                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start [--server <url>]`                    | Spawns `node --import tsx src/main.ts` detached, waits for the `started` record and prints `{ pid, log, name, assignees, serverUrl }`. Its defaults: name and assignee `run-runner`, `SEXTOU_RUNNER_POLL_MS=500`, `SEXTOU_RUNNER_LOG_LEVEL=debug`. Any `SEXTOU_RUNNER_*` you export wins. It ignores `apps/runner/.env`. On an invalid variable it prints the runner's error record and exits 1.         |
| `wait <msg> [--task <id>] [--timeout <ms>]` | Prints the first log record whose `msg` is `<msg>` (and whose `taskId` is `<id>`), or exits 1 after 15 s or once the runner exited. `--timeout` takes milliseconds only. The messages: `started`, `claim failed`, `claimed`, `output` (with `stream` and `line`), `heartbeat` (debug), `heartbeat failed`, `lease lost`, `complete failed`, `complete refused`, `completed` (with `outcome`), `stopped`. |
| `log`                                       | Prints the runner's log, one JSON record per line.                                                                                                                                                                                                                                                                                                                                                       |
| `stop`                                      | SIGTERM, waits up to 10 s, then SIGKILL. The log stays in its `/tmp/sextou-runner-*` folder.                                                                                                                                                                                                                                                                                                             |
| `smoke`                                     | The flow above, against its own server.                                                                                                                                                                                                                                                                                                                                                                  |

The running runner's state is in `/tmp/sextou-run-runner/state.json` (`$RUN_RUNNER_STATE` overrides it). One runner per state file: `start` refuses while one runs.

To see a task reopen after the runner stops mid-run:

```bash
export SEXTOU_SERVER_LEASE_MS=1500 SEXTOU_SERVER_LEASE_SWEEP_MS=200 SEXTOU_SERVER_MAX_ATTEMPTS=2
node $S start
node .claude/skills/run-runner/driver.mjs start
node $S call tasks.create '{"title":"A","kind":"task","priority":2,"assignee":"run-runner","createdBy":"me"}'
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
SEXTOU_RUNNER_SERVER_URL=http://127.0.0.1:4310 pnpm --filter @sextou/runner dev   # JSON lines on stdout; Ctrl-C logs stopped and exits
```

Its name, and so its only assignee, is the machine's hostname unless `SEXTOU_RUNNER_NAME` says otherwise, and heartbeats aren't logged at the default level. An agent should use the driver instead.

## Test

```bash
pnpm --filter @sextou/runner test:unit         # 100% coverage
pnpm --filter @sextou/runner test:integration  # main.ts against the server started as a child process, and taskfile.ts; needs go-task
pnpm --filter @sextou/runner test:mutation     # Stryker, about 1.5 min, fails below 80%
```

## Gotchas

- **A task only reaches a runner that serves its assignee.** The driver's runner serves `run-runner`, so create tasks with `"assignee":"run-runner"`. With `pnpm dev`, the assignee is the hostname.
- **The server's URL is fixed when the runner starts.** `run-server`'s `start` listens on a new free port each time, so a runner left running keeps calling the old port after a server restart, and logs `heartbeat failed` / `complete failed` with `no_answer` forever. Restart the runner too, or give the server a fixed `SEXTOU_SERVER_PORT`.
- **Stopping the runner mid-run doesn't complete the task.** The server's sweep ends the attempt once its lease runs out: with the server's default `SEXTOU_SERVER_MAX_ATTEMPTS=1` the task fails, so set it to 2 or more to see it claimed again.
- **`heartbeat` records are debug.** The driver's `start` and `smoke` log at debug; `pnpm dev` doesn't, unless `SEXTOU_RUNNER_LOG_LEVEL=debug`.
- **The runner heartbeats every third of the lease the server answers**, not of anything the runner sets. To see several heartbeats in the stub's 2 s run, shorten `SEXTOU_SERVER_LEASE_MS`.
- **The driver kills the right process because it skips `pnpm` and `tsx`.** It runs `node --import tsx src/main.ts`, one process, so its pid is the runner's. Under `pnpm dev`, the pid you hold is a wrapper.
- **`pnpm dev` prints `.env not found. Continuing without it.` twice.** That's tsx's `--env-file-if-exists`, not an error.
- **Lint scans this folder.** `lint / gates` refuses `console` outside test files, so the driver writes through `process.stdout`/`process.stderr`. Run `pnpm exec oxlint -c .oxlintrc.gates.json .` and `pnpm exec oxfmt --check .` after editing it.

## Troubleshooting

- **`No server URL: pass --server <url>, …`**: no `--server`, no `SEXTOU_RUNNER_SERVER_URL`, and no server from `run-server`. Start one with `node ../server/.claude/skills/run-server/driver.mjs start`.
- **`The runner did not start.` followed by `Invalid SEXTOU_RUNNER_…`**: an exported variable has a bad value. The record names it and what it expects.
- **`No claimed record.`**: the task's assignee isn't one the runner serves, or the runner's server isn't the one you created the task on. Compare `start`'s `assignees` and `serverUrl` with the task.
- **`Already running: pid …`**: a runner from an earlier `start` is still up. Run `stop`, or set `RUN_RUNNER_STATE` to another path to run a second one.
