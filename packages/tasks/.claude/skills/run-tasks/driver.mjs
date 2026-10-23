#!/usr/bin/env node
// Calls @sextou/tasks's operations through its public export, on a database
// file that persists between calls, with a clock the caller sets. Run from
// packages/tasks/:
//
//   node --import tsx .claude/skills/run-tasks/driver.mjs call <operation> [json]
//   node --import tsx .claude/skills/run-tasks/driver.mjs query <sql>
//   node --import tsx .claude/skills/run-tasks/driver.mjs smoke
//   node --import tsx .claude/skills/run-tasks/driver.mjs reset
//
// The database is $RUN_TASKS_DB (default: <tmpdir>/sextou-run-tasks/tasks.db).
// $RUN_TASKS_NOW, in milliseconds since the epoch, is the clock of every
// call: set it to move time, as to let a lease expire. Date.now otherwise.
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { connect } from '@tursodatabase/database';
import { openTasks } from '@sextou/tasks';

const database =
  process.env.RUN_TASKS_DB ?? join(tmpdir(), 'sextou-run-tasks', 'tasks.db');

// The driver's own output: a CLI's, so stdout and stderr, not a logger.
function out(text) {
  process.stdout.write(`${text}\n`);
}

function fail(text) {
  process.stderr.write(`${text}\n`);
}

// What openTasks asks for: Pino's six level methods. Each record goes to
// stderr as one JSON line, so stdout carries only the result.
const logger = Object.fromEntries(
  ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].map((level) => [
    level,
    (object, msg) => fail(JSON.stringify({ level, ...object, msg })),
  ]),
);

function clock() {
  const now = process.env.RUN_TASKS_NOW;
  if (now === undefined) {
    return () => Date.now();
  }
  if (!/^\d+$/.test(now)) {
    fail(`RUN_TASKS_NOW must be milliseconds since the epoch, got ${now}`);
    process.exit(2);
  }
  return () => Number(now);
}

// Opens the graph, runs one operation with the JSON input as its argument,
// prints the result and closes. Exits 1 on a refusal ({ ok: false }).
async function call(operation, json) {
  mkdirSync(dirname(database), { recursive: true });
  const tasks = await openTasks(database, { logger, now: clock() });
  try {
    if (typeof tasks[operation] !== 'function' || operation === 'close') {
      fail(
        `No operation ${operation}. One of: ${Object.keys(tasks)
          .filter((name) => name !== 'close')
          .join(', ')}`,
      );
      process.exit(2);
    }
    const result = await tasks[operation](
      json === undefined ? undefined : JSON.parse(json),
    );
    out(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
    }
  } finally {
    await tasks.close();
  }
}

// Reads the file with Turso directly, for what the operations don't return:
// task_status_changes, task_executions, the blockers' count.
async function query(sql) {
  const db = await connect(database);
  try {
    out(JSON.stringify(await db.all(sql), null, 2));
  } finally {
    await db.close();
  }
}

// A task's whole life on an in-memory graph with a fake clock: links,
// ready list, claim and its resend, renew, the lease expiring into a second
// attempt, a stale finish refused, cancel requested and seen, finish and its
// resend, and the blocked task freed. Exits 1 at the first step that differs.
async function smoke() {
  let now = 1_700_000_000_000;
  const tasks = await openTasks(':memory:', { logger, now: () => now });
  const leaseMs = 1000;
  const steps = [];
  const step = async (name, run, check) => {
    const result = await run();
    const ok = check(result);
    steps.push(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(result)}`);
    if (!ok) {
      out(steps.join('\n'));
      await tasks.close();
      process.exit(1);
    }
    return result;
  };
  const newTask = (title) => ({
    title,
    kind: 'task',
    priority: 2,
    assignee: 'dev',
    createdBy: 'smoke',
  });
  const ready = () => tasks.listReady({ assignees: ['dev'], limit: 10 });
  const ids = (result) => result.tasks.map((task) => task.id);

  const { task: a } = await step(
    'create a',
    () => tasks.createTask(newTask('A')),
    (r) => r.ok && r.task.status === 'open',
  );
  const { task: b } = await step(
    'create b',
    () => tasks.createTask(newTask('B')),
    (r) => r.ok,
  );
  await step(
    'link b blocked by a',
    () => tasks.link({ taskId: b.id, blockerId: a.id }),
    (r) => r.ok,
  );
  await step(
    'link a blocked by b: a cycle',
    () => tasks.link({ taskId: a.id, blockerId: b.id }),
    (r) => !r.ok && r.reason === 'cycle',
  );
  await step(
    'ready lists only a',
    ready,
    (r) => r.ok && ids(r).join() === a.id,
  );
  const claim = { claimId: 'c1', assignees: ['dev'], actor: 'r1', leaseMs };
  const first = await step(
    'claim a',
    () => tasks.claimTask(claim),
    (r) => r.ok && r.task?.id === a.id && r.execution.attempt === 1,
  );
  await step(
    'claim resent',
    () => tasks.claimTask(claim),
    (r) => r.ok && r.execution?.id === first.execution.id,
  );
  await step(
    'claim, nothing ready',
    () => tasks.claimTask({ ...claim, claimId: 'c2' }),
    (r) => r.ok && r.task === null,
  );
  now += leaseMs / 2;
  await step(
    'renew',
    () => tasks.renewExecution({ executionId: first.execution.id, leaseMs }),
    (r) => r.ok && r.cancelRequested === false,
  );
  now += leaseMs;
  await step(
    'expire after the lease, attempts left',
    () => tasks.expireExecutions({ maxAttempts: 2, changedBy: 'sweep' }),
    (r) =>
      r.ok &&
      r.expired.length === 1 &&
      r.expired[0].taskId === a.id &&
      r.expired[0].status === 'open',
  );
  await step(
    'renew the expired attempt',
    () => tasks.renewExecution({ executionId: first.execution.id, leaseMs }),
    (r) => !r.ok && r.reason === 'lease_lost',
  );
  const second = await step(
    'claim a again',
    () => tasks.claimTask({ ...claim, claimId: 'c3' }),
    (r) => r.ok && r.task?.id === a.id && r.execution.attempt === 2,
  );
  await step(
    'finish from the stale attempt',
    () =>
      tasks.finishTask({
        executionId: first.execution.id,
        changedBy: 'r1',
        status: 'succeeded',
      }),
    (r) => !r.ok && r.reason === 'lease_lost',
  );
  await step(
    'cancel running a',
    () => tasks.cancelTask({ id: a.id, changedBy: 'smoke', reason: 'test' }),
    (r) => r.ok && r.status === 'running',
  );
  await step(
    'renew sees the cancel',
    () => tasks.renewExecution({ executionId: second.execution.id, leaseMs }),
    (r) => r.ok && r.cancelRequested === true,
  );
  const finish = {
    executionId: second.execution.id,
    changedBy: 'r1',
    status: 'succeeded',
  };
  await step(
    'finish a',
    () => tasks.finishTask(finish),
    (r) => r.ok,
  );
  await step(
    'finish resent',
    () => tasks.finishTask(finish),
    (r) => r.ok,
  );
  await step(
    'cancel the finished a',
    () => tasks.cancelTask({ id: a.id, changedBy: 'smoke' }),
    (r) => !r.ok && r.reason === 'already_finished',
  );
  await step(
    'ready lists b, freed',
    ready,
    (r) => r.ok && ids(r).join() === b.id,
  );
  await tasks.close();
  out(steps.join('\n'));
}

// Deletes the database file and its WAL.
function reset() {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${database}${suffix}`, { force: true });
  }
  out(`removed ${database}`);
}

// Last, once every const above is initialized. An error, such as Turso
// refusing a file another process holds or a query it can't parse, prints
// its message and exits 1.
const [command, ...args] = process.argv.slice(2);
const commands = { call, query, smoke, reset };
if (!(command in commands)) {
  fail(
    'usage: driver.mjs call <operation> [json] | query <sql> | smoke | reset',
  );
  process.exit(2);
}
try {
  await commands[command](...args);
} catch (error) {
  fail(error.message);
  process.exit(1);
}
