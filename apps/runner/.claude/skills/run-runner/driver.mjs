#!/usr/bin/env node
// Starts @sextou/runner in the background against a server, waits for what
// it logs, and stops it; or runs the whole flow against a server of its own.
// Run from apps/runner/:
//
//   node .claude/skills/run-runner/driver.mjs start [--server <url>]
//   node .claude/skills/run-runner/driver.mjs wait <msg> [--task <id>] [--timeout <ms>]
//   node .claude/skills/run-runner/driver.mjs log
//   node .claude/skills/run-runner/driver.mjs stop
//   node .claude/skills/run-runner/driver.mjs smoke
//
// start takes the server's URL from --server, else SEXTOU_RUNNER_SERVER_URL,
// else the server the run-server skill started. It ignores apps/runner/.env;
// any SEXTOU_RUNNER_* already in the environment wins over the driver's
// defaults. The running runner's pid and log live in $RUN_RUNNER_STATE
// (default: <tmpdir>/sextou-run-runner/state.json).
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
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const unit = resolve(import.meta.dirname, '..', '..', '..');
// The run-server skill's driver, and the state file its start writes.
const serverDriver = resolve(
  unit,
  '..',
  'server',
  '.claude/skills/run-server/driver.mjs',
);
const stateFile =
  process.env.RUN_RUNNER_STATE ??
  join(tmpdir(), 'sextou-run-runner', 'state.json');
// Where run-server's driver keeps its state: the same default as its own.
const serverStateFile =
  process.env.RUN_SERVER_STATE ??
  join(tmpdir(), 'sextou-run-server', 'state.json');

// Short enough to watch a whole task in a few seconds, with each heartbeat
// in the log: the server's stub Taskfile runs for 2 seconds.
const defaults = {
  SEXTOU_RUNNER_NAME: 'run-runner',
  SEXTOU_RUNNER_POLL_MS: '500',
  SEXTOU_RUNNER_LOG_LEVEL: 'debug',
};

const [command, ...args] = process.argv.slice(2);
const commands = { start, wait, log, stop, smoke };
if (!(command in commands)) {
  fail(
    'usage: driver.mjs start [--server <url>] | wait <msg> [--task <id>] [--timeout <ms>] | log | stop | smoke',
  );
  process.exit(2);
}
await commands[command](...args);

function option(list, name) {
  const at = list.indexOf(name);
  return at === -1 ? undefined : list[at + 1];
}

function readState() {
  if (!existsSync(stateFile)) {
    fail(`No runner running (no ${stateFile}). Run: driver.mjs start`);
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

// Every JSON record in a log file; a line that isn't JSON is skipped.
function records(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

// Resolves with the first record whose msg is `msg` (and whose taskId is
// `taskId`, when given), or undefined once `timeoutMs` pass or `pid` exits.
async function waitFor(file, pid, msg, { taskId, timeoutMs = 15_000 } = {}) {
  for (let waited = 0; waited <= timeoutMs; waited += 100) {
    const record = records(file).find(
      (candidate) =>
        candidate.msg === msg &&
        (taskId === undefined || candidate.taskId === taskId),
    );
    if (record) {
      return record;
    }
    if (!alive(pid)) {
      return undefined;
    }
    await sleep(100);
  }
  return undefined;
}

// Spawns the runner's main.ts with node, detached, its stdout and stderr in
// a new log file. Node with tsx's loader is the one process that runs
// main.ts, so the pid is the runner's.
function launch(env) {
  const logFile = join(
    mkdtempSync(join(tmpdir(), 'sextou-runner-')),
    'out.log',
  );
  const logFd = openSync(logFile, 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: unit,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env,
  });
  closeSync(logFd);
  child.unref();
  return { pid: child.pid, log: logFile };
}

function serverUrl(list) {
  const url = option(list, '--server') ?? process.env.SEXTOU_RUNNER_SERVER_URL;
  if (url) {
    return url;
  }
  if (existsSync(serverStateFile)) {
    return JSON.parse(readFileSync(serverStateFile, 'utf8')).url;
  }
  fail(
    'No server URL: pass --server <url>, or start one with apps/server/.claude/skills/run-server/driver.mjs start',
  );
  process.exit(1);
}

async function start(...list) {
  const prior = existsSync(stateFile) && readState();
  if (prior && alive(prior.pid)) {
    fail(`Already running: pid ${prior.pid}. Run: driver.mjs stop`);
    process.exit(1);
  }
  mkdirSync(dirname(stateFile), { recursive: true });
  const runner = launch({
    ...defaults,
    ...process.env,
    SEXTOU_RUNNER_SERVER_URL: serverUrl(list),
  });
  const started = await waitFor(runner.log, runner.pid, 'started');
  if (!started) {
    fail(`The runner did not start. Its log, ${runner.log}:`);
    fail(readFileSync(runner.log, 'utf8'));
    if (alive(runner.pid)) {
      process.kill(runner.pid, 'SIGTERM');
    }
    process.exit(1);
  }
  const state = {
    pid: runner.pid,
    log: runner.log,
    name: started.name,
    assignees: started.assignees,
    serverUrl: started.serverUrl,
  };
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
  out(JSON.stringify(state, null, 2));
}

// Prints the record and exits 0, or exits 1 when it doesn't come in time.
async function wait(msg, ...list) {
  const { pid, log: logFile } = readState();
  const timeout = option(list, '--timeout');
  if (timeout !== undefined && !/^\d+$/.test(timeout)) {
    fail(`--timeout takes milliseconds, as 15000: got ${timeout}`);
    process.exit(2);
  }
  const record = await waitFor(logFile, pid, msg, {
    taskId: option(list, '--task'),
    timeoutMs: timeout === undefined ? undefined : Number(timeout),
  });
  if (!record) {
    fail(`No ${msg} record. Run: driver.mjs log`);
    process.exit(1);
  }
  out(JSON.stringify(record));
}

function log() {
  process.stdout.write(readFileSync(readState().log, 'utf8'));
}

// SIGTERM is main.ts's stop: no new call, the one in flight finishes, it
// logs stopped and exits 0. A task it held is left to the server's sweep.
async function stop() {
  const { pid, log: logFile } = readState();
  await terminate(pid);
  rmSync(stateFile);
  out(`stopped ${pid}; log: ${logFile}`);
}

async function terminate(pid) {
  if (!alive(pid)) {
    return;
  }
  process.kill(pid, 'SIGTERM');
  for (let waited = 0; alive(pid) && waited < 10_000; waited += 100) {
    await sleep(100);
  }
  if (alive(pid)) {
    process.kill(pid, 'SIGKILL');
  }
}

// A port nothing listens on: one a closed listener freed.
async function freePort() {
  const listener = createServer().listen(0, '127.0.0.1');
  await new Promise((ready) => listener.once('listening', ready));
  const { port } = listener.address();
  await new Promise((closed) => listener.close(closed));
  return port;
}

// Runs the run-server driver with `args`, its state in `serverState`, and
// resolves with what it printed. Its start lets SEXTOU_SERVER_* in `env` win.
// The environment without any SEXTOU_* setting, so the smoke's runner and
// server take only the settings it gives them.
function cleanEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('SEXTOU_')),
  );
}

function serverCommand(args, serverState, env = {}) {
  return new Promise((done, failed) => {
    const child = spawn(process.execPath, [serverDriver, ...args], {
      env: { ...cleanEnv(), ...env, RUN_SERVER_STATE: serverState },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let printed = '';
    child.stdout.on('data', (chunk) => {
      printed += chunk;
    });
    child.on('error', failed);
    child.on('exit', (code) =>
      code === 0
        ? done(printed)
        : failed(new Error(`run-server ${args[0]} exited with ${code}`)),
    );
  });
}

// The runner's whole flow against a server of its own, with a short lease:
// no server, a task completed as succeeded, a task cancelled while held, and
// the stop. Touches neither skill's usual state file. Exits 1 at the first
// step that differs.
async function smoke() {
  const steps = [];
  const pids = [];
  const serverState = join(
    mkdtempSync(join(tmpdir(), 'sextou-run-runner-smoke-')),
    'server.json',
  );
  const stopServer = () =>
    existsSync(serverState)
      ? serverCommand(['stop'], serverState).catch(() => undefined)
      : undefined;
  const check = async (name, ok, detail) => {
    const shown =
      detail === undefined || typeof detail === 'string'
        ? detail
        : JSON.stringify(detail);
    steps.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${shown ? `: ${shown}` : ''}`);
    if (!ok) {
      out(steps.join('\n'));
      for (const pid of pids) {
        await terminate(pid);
      }
      await stopServer();
      process.exit(1);
    }
  };
  const run = Date.now().toString(36);
  const assignee = `smoke-${run}`;
  const env = (url) => ({
    ...cleanEnv(),
    ...defaults,
    SEXTOU_RUNNER_SERVER_URL: url,
    SEXTOU_RUNNER_NAME: assignee,
  });

  // A step that throws, as a call whose answer isn't what it expects, fails
  // the smoke and stops what it started, as a failed check does.
  let runnerLog;
  try {
    // The server boots while the runner tries a port nothing listens on.
    const booting = serverCommand(['start'], serverState, {
      SEXTOU_SERVER_LEASE_MS: '600',
      SEXTOU_SERVER_LEASE_SWEEP_MS: '100',
    }).then(
      (printed) => JSON.parse(printed).url,
      () => undefined,
    );
    const offline = launch(env(`http://127.0.0.1:${await freePort()}`));
    pids.push(offline.pid);
    const failed = await waitFor(offline.log, offline.pid, 'claim failed');
    await check(
      'claim with no server',
      failed?.failure === 'no_answer',
      failed,
    );
    await terminate(offline.pid);

    const url = await booting;
    await check('server listening', Boolean(url), url);
    const call = async (procedure, input) => {
      const response = await fetch(`${url}/trpc/${procedure}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(30_000),
      });
      return (await response.json()).result?.data;
    };
    const create = (title) =>
      call('tasks.create', {
        title,
        kind: 'task',
        priority: 2,
        assignee,
        createdBy: 'smoke',
      });

    const runner = launch(env(url));
    pids.push(runner.pid);
    const seen = (msg, taskId) =>
      waitFor(runner.log, runner.pid, msg, { taskId });
    const started = await seen('started');
    await check('runner started', Boolean(started), started);

    const done = await create('Succeeds');
    await check('created a task', Boolean(done?.id), done);
    const claimed = await seen('claimed', done.id);
    await check('claimed', Boolean(claimed), claimed);
    const beat = await seen('heartbeat', done.id);
    await check('heartbeat', beat?.cancel === false, beat);
    const succeeded = await seen('completed', done.id);
    await check(
      'completed as succeeded',
      succeeded?.outcome === 'succeeded',
      succeeded,
    );
    await check(
      'ran the stub Taskfile',
      records(runner.log).some(
        (record) =>
          record.msg === 'output' &&
          record.taskId === done.id &&
          record.line === 'sextou stub',
      ),
    );

    const cancelled = await create('Cancelled');
    await check('created a second task', Boolean(cancelled?.id), cancelled);
    await check(
      'claimed the second task',
      Boolean(await seen('claimed', cancelled.id)),
    );
    const cancel = await call('tasks.cancel', {
      taskId: cancelled.id,
      actor: 'smoke',
    });
    await check('cancel while it runs', cancel?.status === 'running', cancel);
    const ended = await seen('completed', cancelled.id);
    await check(
      'completed as cancelled',
      ended?.outcome === 'cancelled',
      ended,
    );
    const left = await call('runners.claim', {
      claimId: `c-${run}`,
      runner: 'other',
      assignees: [assignee],
    });
    await check('nothing left to claim', left?.task === null);

    await terminate(runner.pid);
    await check(
      'stopped on SIGTERM',
      records(runner.log).at(-1)?.msg === 'stopped',
    );
    await stopServer();
    runnerLog = runner.log;
  } catch (error) {
    await check('no error', false, error.message);
  }
  steps.push(`runner log: ${runnerLog}`);
  out(steps.join('\n'));
}
