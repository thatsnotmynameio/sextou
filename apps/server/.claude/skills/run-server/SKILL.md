---
name: run-server
description: Start, run, build, smoke-test, stop and call the sextou server (@sextou/server, apps/server) over HTTP. Use when asked to run or start the server, call a tRPC procedure (health, tasks.create/cancel/assign, runners.claim/heartbeat/complete), try a lease or heartbeat flow by hand, check that a server change works end to end, or run its tests.
---

The server is a Node process that serves tRPC at `/trpc`. An agent drives it with `.claude/skills/run-server/driver.mjs`, which starts it in the background on a free port with throwaway databases, sends procedure calls over HTTP, runs a smoke flow, and stops it. The driver needs nothing but Node.

All paths below are relative to `apps/server/`. Run `pnpm` commands from the repository root.

## Setup

```bash
pnpm install          # from the repository root
```

No variable is required. `.env.example` lists each `SEXTOU_SERVER_*` setting with its default.

## Build

Only needed for `start --build`, which runs the production bundle:

```bash
pnpm --filter @sextou/server build   # -> dist/server.mjs and dist/drizzle/
```

## Run (agent path)

```bash
node .claude/skills/run-server/driver.mjs start      # from source (tsx); --build runs dist/server.mjs
node .claude/skills/run-server/driver.mjs smoke      # the runner flow below; exits 1 at the first wrong step
node .claude/skills/run-server/driver.mjs call health.check
node .claude/skills/run-server/driver.mjs call tasks.create '{"title":"Say hi","kind":"task","priority":2,"assignee":"dev","createdBy":"alice"}'
node .claude/skills/run-server/driver.mjs call runners.claim '{"claimId":"c1","runner":"r1","assignees":["dev"]}'
node .claude/skills/run-server/driver.mjs call runners.heartbeat '{"executionId":"exe_…"}'
node .claude/skills/run-server/driver.mjs log        # the server's JSON log lines
node .claude/skills/run-server/driver.mjs stop       # SIGTERM, waits for the graceful shutdown
```

| command                   | what it does                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start [--build]`         | Spawns the server detached with `SEXTOU_SERVER_PORT=0` and `SEXTOU_SERVER_DATA_DIR` set to a new `/tmp/sextou-server-data-*` folder. Waits for the `listening` log record and prints `{ url, pid, log, dataDir }`. Any `SEXTOU_SERVER_*` you export wins over those two defaults: export `SEXTOU_SERVER_DATA_DIR` to restart on the same databases. The log always goes to the new folder. It ignores `apps/server/.env`. |
| `call <procedure> [json]` | No JSON sends a GET (a query: only `health.check`). JSON sends a POST (a mutation: every other procedure). Prints `{ status, body }` and exits 1 on a non-2xx status.                                                                                                                                                                                                                                                     |
| `smoke`                   | health, create, claim (its task points at the stub's Taskfile, `tasks/hello-world/`), the same claim resent, a claim with nothing left, heartbeat, cancel while running, a heartbeat that sees `cancel: true`, complete, the same complete resent, then a heartbeat answered `409 lease_lost`. Each run uses its own assignee, so it can run again on the same server.                                                    |
| `log`                     | Prints the log file.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `stop`                    | SIGTERM to the server's pid, waits up to 10 s, then SIGKILL. The data folder and its `server.log` stay.                                                                                                                                                                                                                                                                                                                   |

The running server's state is in `/tmp/sextou-run-server/state.json` (`$RUN_SERVER_STATE` overrides it). One server per state file: `start` refuses while one runs.

To see the lease sweep end an attempt, export short leases before `start`. This run reopens the task as attempt 2 (verified):

```bash
export SEXTOU_SERVER_LEASE_MS=1500 SEXTOU_SERVER_LEASE_SWEEP_MS=200 SEXTOU_SERVER_MAX_ATTEMPTS=2
node .claude/skills/run-server/driver.mjs start --build
node .claude/skills/run-server/driver.mjs call tasks.create '{"title":"Lease","kind":"task","priority":1,"assignee":"lease","createdBy":"me"}'
node .claude/skills/run-server/driver.mjs call runners.claim '{"claimId":"a","runner":"r","assignees":["lease"]}'
sleep 3.5
node .claude/skills/run-server/driver.mjs call runners.claim '{"claimId":"b","runner":"r","assignees":["lease"]}'   # same task, "attempt": 2
node .claude/skills/run-server/driver.mjs stop
```

Without the driver, the wire format is plain JSON. The input is the body, and the answer is `{"result":{"data":…}}` or `{"error":{"message","data":{"code","httpStatus"}}}`:

```bash
curl -s http://127.0.0.1:4310/trpc/health.check
curl -s -X POST http://127.0.0.1:4310/trpc/runners.claim -H 'content-type: application/json' -d '{"claimId":"c1","runner":"r1","assignees":["dev"]}'
```

## Run (human path)

```bash
pnpm --filter @sextou/server dev   # tsx watch on http://127.0.0.1:4310, reads apps/server/.env if present. Ctrl-C to stop.
```

It keeps its databases in `apps/server/storage`, the checkout's own, and listens on the fixed port 4310. An agent should use the driver instead, which never touches that folder.

## Test

```bash
pnpm --filter @sextou/server test:unit                     # 156 tests, 90% coverage floor per file
pnpm --filter @sextou/server test:integration              # starts the server for real (main.test.ts)
pnpm exec vitest run --project 'server/*' modules/runners  # one module, no coverage verdict
```

## Gotchas

- **The driver kills the right process because it skips `pnpm` and `tsx`.** It runs `node --import tsx src/main.ts`, one process, so its pid is the server's. Under `pnpm exec tsx` or `pnpm dev`, the pid you hold is a wrapper. Killing it can leave the server listening, and the `tsx watch` parent has to be killed on its own.
- **A mutation over GET answers 405** (`METHOD_NOT_SUPPORTED`). Every procedure but `health.check` is a mutation.
- **`SEXTOU_SERVER_LOG_LEVEL=warn` (or higher) makes `start` wait 30 s and fail.** The URL comes from the `listening` record, which is logged at info.
- **A heartbeat still renews after the lease time passes**, until the sweep ends the attempt. To see `lease_lost` from expiry, wait past `LEASE_MS` plus a sweep. After a start, the sweep ends no lease until the server has been up a whole lease.
- **A finished attempt answers `409 lease_lost`** on heartbeat. A complete identical to the last one answers 200 again, and a claim resent with the same `claimId` returns the same `exe_…`.
- **Lint scans this folder.** `lint / gates` refuses `console` outside test files, so the driver writes through `process.stdout`/`process.stderr`. Run `pnpm exec oxlint -c .oxlintrc.gates.json .` and `pnpm exec oxfmt --check .` after editing it.

## Troubleshooting

- **`The server did not listen.` followed by `Invalid SEXTOU_SERVER_…`**: an exported variable has a bad value. The log line names it and what it expects. Unset it or fix it.
- **`The server did not listen.` with an empty log**: `SEXTOU_SERVER_LOG_LEVEL` is warn or higher. Unset it.
- **`No dist/server.mjs`** on `start --build`: run `pnpm --filter @sextou/server build` first.
- **`Already running: …`**: a server from an earlier `start` is still up. Run `stop`, or set `RUN_SERVER_STATE` to another path to run a second one.
