#!/usr/bin/env node
// Starts @sextou/server in the background, calls its tRPC procedures over
// HTTP, and stops it. Run from apps/server/:
//
//   node .claude/skills/run-server/driver.mjs start [--build]
//   node .claude/skills/run-server/driver.mjs call <procedure> [json]
//   node .claude/skills/run-server/driver.mjs smoke
//   node .claude/skills/run-server/driver.mjs log
//   node .claude/skills/run-server/driver.mjs stop
//
// start listens on a free port, with both databases in a fresh folder, and
// ignores apps/server/.env. Any SEXTOU_SERVER_* already in the environment
// wins over those defaults. The running server's URL, pid and log live in
// $RUN_SERVER_STATE (default: <tmpdir>/sextou-run-server/state.json).
import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const unit = resolve(import.meta.dirname, '..', '..', '..');
const stateFile =
  process.env.RUN_SERVER_STATE ??
  join(tmpdir(), 'sextou-run-server', 'state.json');

const [command, ...args] = process.argv.slice(2);
const commands = { start, call, smoke, log, stop };
if (!(command in commands)) {
  fail(
    'usage: driver.mjs start [--build] | call <procedure> [json] | smoke | log | stop',
  );
  process.exit(2);
}
await commands[command](...args);

function readState() {
  if (!existsSync(stateFile)) {
    fail(`No server running (no ${stateFile}). Run: driver.mjs start`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(stateFile, 'utf8'));
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// The driver's own output: a CLI's, so stdout and stderr, not a logger.
function out(text) {
  process.stdout.write(`${text}\n`);
}

function fail(text) {
  process.stderr.write(`${text}\n`);
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

async function start(flag) {
  if (existsSync(stateFile) && alive(readState().pid)) {
    fail(`Already running: ${readState().url}. Run: driver.mjs stop`);
    process.exit(1);
  }
  const build = flag === '--build';
  const bundle = join(unit, 'dist', 'server.mjs');
  if (build && !existsSync(bundle)) {
    fail('No dist/server.mjs. Run: pnpm --filter @sextou/server build');
    process.exit(1);
  }
  mkdirSync(dirname(stateFile), { recursive: true });
  // The log goes in a fresh folder, which is also the data folder unless
  // SEXTOU_SERVER_DATA_DIR names one, as to restart on the same databases.
  const runDir = mkdtempSync(join(tmpdir(), 'sextou-server-data-'));
  const dataDir = process.env.SEXTOU_SERVER_DATA_DIR ?? runDir;
  const logFile = join(runDir, 'server.log');
  const logFd = openSync(logFile, 'a');
  // From source, node with tsx's loader is the one process that runs
  // main.ts, so its pid is the server's.
  const argv = build ? [bundle] : ['--import', 'tsx', 'src/main.ts'];
  const child = spawn(process.execPath, argv, {
    cwd: unit,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      SEXTOU_SERVER_PORT: '0',
      SEXTOU_SERVER_DATA_DIR: dataDir,
      ...process.env,
    },
  });
  closeSync(logFd);
  child.unref();

  // main.ts logs { msg: 'listening', url } once it listens. At
  // SEXTOU_SERVER_LOG_LEVEL warn or above that record never comes.
  for (let waited = 0; waited < 30_000; waited += 200) {
    const listening = readFileSync(logFile, 'utf8')
      .split('\n')
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return undefined;
        }
      })
      .find((record) => record?.msg === 'listening');
    if (listening) {
      const state = {
        url: listening.url,
        pid: child.pid,
        log: logFile,
        dataDir,
      };
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
      out(JSON.stringify(state, null, 2));
      return;
    }
    if (!alive(child.pid)) {
      break;
    }
    await sleep(200);
  }
  fail(`The server did not listen. Its log, ${logFile}:`);
  if (
    ['warn', 'error', 'fatal', 'silent'].includes(
      process.env.SEXTOU_SERVER_LOG_LEVEL,
    )
  ) {
    fail(
      'SEXTOU_SERVER_LOG_LEVEL drops the listening record: unset it or use info.',
    );
  }
  fail(readFileSync(logFile, 'utf8'));
  if (alive(child.pid)) {
    process.kill(child.pid, 'SIGTERM');
  }
  process.exit(1);
}

// A procedure with no input is a query, sent as GET (health.check); one
// with input is a mutation, sent as POST. Every procedure but health.check
// is a mutation. Prints { status, body }; exits 1 unless the status is 2xx.
async function call(procedure, json) {
  const result = await request(
    procedure,
    json === undefined ? undefined : JSON.parse(json),
  );
  out(JSON.stringify(result, null, 2));
  if (result.status >= 300) {
    process.exit(1);
  }
}

async function request(procedure, input) {
  const { url } = readState();
  const response = await fetch(`${url}/trpc/${procedure}`, {
    method: input === undefined ? 'GET' : 'POST',
    headers: input === undefined ? {} : { 'content-type': 'application/json' },
    body: input === undefined ? undefined : JSON.stringify(input),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.json() };
}

// One runner's whole flow: create, claim, heartbeat, cancel, complete, and
// the conflict a lost lease gets. Exits 1 at the first step that differs.
async function smoke() {
  const run = Date.now().toString(36);
  const steps = [];
  const step = async (name, procedure, input, check) => {
    const { status, body } = await request(procedure, input);
    const ok = check(status, body);
    steps.push(
      `${ok ? 'ok  ' : 'FAIL'} ${name}: ${status} ${JSON.stringify(body)}`,
    );
    if (!ok) {
      out(steps.join('\n'));
      process.exit(1);
    }
    return body.result?.data;
  };
  const assignee = `smoke-${run}`;
  await step(
    'health',
    'health.check',
    undefined,
    (s, b) => s === 200 && b.result.data.database === 'up',
  );
  const task = await step(
    'create',
    'tasks.create',
    { title: 'Smoke', kind: 'task', priority: 2, assignee, createdBy: 'smoke' },
    (s, b) => s === 200 && b.result.data.status === 'open',
  );
  const claim = {
    claimId: `c-${run}`,
    runner: 'smoke-runner',
    assignees: [assignee],
  };
  const claimed = await step(
    'claim',
    'runners.claim',
    claim,
    (s, b) => s === 200 && b.result.data.task?.id === task.id,
  );
  const executionId = claimed.execution.id;
  await step(
    'claim resent',
    'runners.claim',
    claim,
    (s, b) => s === 200 && b.result.data.execution?.id === executionId,
  );
  await step(
    'claim, nothing left',
    'runners.claim',
    { ...claim, claimId: `c2-${run}` },
    (s, b) => s === 200 && b.result.data.task === null,
  );
  await step(
    'heartbeat',
    'runners.heartbeat',
    { executionId },
    (s, b) => s === 200 && b.result.data.cancel === false,
  );
  await step(
    'cancel running',
    'tasks.cancel',
    { taskId: task.id, actor: 'smoke' },
    (s, b) => s === 200 && b.result.data.status === 'running',
  );
  await step(
    'heartbeat sees cancel',
    'runners.heartbeat',
    { executionId },
    (s, b) => s === 200 && b.result.data.cancel === true,
  );
  const complete = {
    runner: 'smoke-runner',
    executionId,
    outcome: 'cancelled',
  };
  await step('complete', 'runners.complete', complete, (s) => s === 200);
  await step('complete resent', 'runners.complete', complete, (s) => s === 200);
  await step(
    'heartbeat after the end',
    'runners.heartbeat',
    { executionId },
    (s, b) => s === 409 && b.error.message === 'lease_lost',
  );
  out(steps.join('\n'));
}

function log() {
  process.stdout.write(readFileSync(readState().log, 'utf8'));
}

// SIGTERM is main.ts's shutdown: stop listening, the sweep, the tasks
// service, the database; then it exits 0. The data folder stays, with the
// log in it.
async function stop() {
  const { pid, log: logFile } = readState();
  if (alive(pid)) {
    process.kill(pid, 'SIGTERM');
    for (let waited = 0; alive(pid) && waited < 10_000; waited += 100) {
      await sleep(100);
    }
    if (alive(pid)) {
      process.kill(pid, 'SIGKILL');
    }
  }
  rmSync(stateFile);
  out(`stopped ${pid}; log: ${logFile}`);
}
