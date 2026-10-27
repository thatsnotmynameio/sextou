import { createHash, randomBytes } from 'node:crypto';
import {
  and,
  desc,
  type EmptyRelations,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  max,
  sql,
} from 'drizzle-orm';
import type { SQLiteAsyncTransaction } from 'drizzle-orm/sqlite-core';
import type {
  TursoDatabaseDatabase,
  TursoDatabaseRunResult,
} from 'drizzle-orm/tursodatabase';
import type { z } from 'zod';
import {
  ready,
  taskExecutions,
  taskExecutionTasks,
  taskLinks,
  tasks,
  taskStatusChanges,
} from './schema';
import {
  assignTaskSchema,
  cancelTaskSchema,
  claimTaskSchema,
  createTaskSchema,
  expireExecutionsSchema,
  finishTaskSchema,
  linkSchema,
  listReadySchema,
  renewExecutionSchema,
  fileTaskKeySchema,
  tasksFileSchema,
  unlinkSchema,
} from './schemas';
import type { Context, FileTask } from './schemas';
import { type FinalStatus, holds, Status } from './status';

// Why an operation changed nothing.
export const Reason = {
  invalid: 'invalid',
  notFound: 'not_found',
  sameTask: 'same_task',
  notOpen: 'not_open',
  cycle: 'cycle',
  leaseLost: 'lease_lost',
  alreadyFinished: 'already_finished',
  timeout: 'timeout',
} as const;

export type Reason = (typeof Reason)[keyof typeof Reason];

export interface Refused<R extends Reason> {
  ok: false;
  reason: R;
}

export interface Task {
  // tsk_ and 32 hex digits. Not a sort key.
  id: string;
  title: string;
  // Any label the caller picks.
  kind: string;
  // 0 is the most urgent, 4 the least.
  priority: number;
  parentId: string | null;
  // Who may take the task: any name the caller uses, never checked.
  assignee: string;
  // What the task asks for.
  description: string | null;
  // A URL or a file path where the task's longer text lives. Stored as given.
  sourcePath: string | null;
  // A JSON object the caller stores with the task. Stored as given.
  context: Context | null;
  // The Taskfile a runner runs for the task, owner/name/path/to/Taskfile.yml@sha,
  // or null when the task names none. splitUses splits it. Stored as given.
  uses: string | null;
  status: Status;
}

export interface NewTask {
  title: string;
  kind: string;
  priority: number;
  // Set only here: a parent organizes and never blocks.
  parentId?: string;
  assignee: string;
  // Blank is stored as null, as is a blank source path.
  description?: string;
  sourcePath?: string;
  context?: Context;
  // The ref is a full commit SHA, 40 lowercase hex digits.
  uses?: string;
  // Recorded with the creation, the first change of the task's status.
  createdBy: string;
}

// The task is blocked by the blocker.
export interface Link {
  taskId: string;
  blockerId: string;
}

// An attempt at running a task, as the one who runs it sees it.
export interface Execution {
  // exe_ and 32 hex digits: the token every later call about the attempt
  // carries.
  id: string;
  // 1 for a task's first attempt, one more for each after.
  attempt: number;
  // When the lease ends unless renewed, in milliseconds since the epoch.
  expiresAt: number;
}

// A task a finish created, by the key its file of tasks gave it.
export interface CreatedTask {
  key: string;
  id: string;
}

// An attempt expireExecutions ended, and the status its task took: open
// again, failed, or cancelled.
export interface ExpiredExecution {
  taskId: string;
  executionId: string;
  attempt: number;
  status: typeof Status.open | typeof Status.failed | typeof Status.cancelled;
}

// Every operation that writes runs in one transaction: a refusal writes
// nothing, and an error from Turso or the file system rejects. Each change of
// a task's status is recorded in that transaction, with when it happened and
// who made it: any name the caller uses, never checked. A write that starts
// or ends past the timeout openTasks got rolls back and is refused as
// timeout, so a caller that gave up never misses one that committed.
//
// A running task's current attempt holds a lease until it ends: only a call
// that carries that attempt's id may renew it or finish the task, so one who
// lost the lease can't overwrite a later attempt.
export interface Graph {
  createTask: (
    task: NewTask,
  ) => Promise<
    | { ok: true; task: Task }
    | Refused<
        typeof Reason.invalid | typeof Reason.notFound | typeof Reason.timeout
      >
  >;
  // Refuses a link that would close a cycle, or whose task isn't open. A pair
  // already linked succeeds and changes nothing.
  link: (
    link: Link,
  ) => Promise<
    | { ok: true }
    | Refused<
        | typeof Reason.invalid
        | typeof Reason.notFound
        | typeof Reason.sameTask
        | typeof Reason.notOpen
        | typeof Reason.cycle
        | typeof Reason.timeout
      >
  >;
  // Refuses a task that isn't open. A pair not linked succeeds and changes
  // nothing.
  unlink: (
    link: Link,
  ) => Promise<
    | { ok: true }
    | Refused<
        | typeof Reason.invalid
        | typeof Reason.notFound
        | typeof Reason.notOpen
        | typeof Reason.timeout
      >
  >;
  // Moves the ready task listReady would list first for these assignees to
  // running and starts its next attempt, leased for leaseMs, in one write, so
  // two claims never take the same task. The actor runs it and is recorded as
  // who started it. task is null when none is ready.
  //
  // claimId is the actor's own name for the claim, which it sends again when
  // the answer didn't reach it. A claim the actor already made with that id
  // starts nothing: while its attempt runs, the answer is that attempt again,
  // its lease pushed to leaseMs from now; once the attempt ended, task is
  // null.
  claimTask: (claim: {
    claimId: string;
    assignees: string[];
    actor: string;
    leaseMs: number;
  }) => Promise<
    | { ok: true; task: Task; execution: Execution }
    | { ok: true; task: null }
    | Refused<typeof Reason.invalid | typeof Reason.timeout>
  >;
  // Pushes the attempt's lease to leaseMs from now, and says whether someone
  // asked to cancel its task. Refuses, as lease_lost, an attempt that doesn't
  // exist or ended, by finishTask or expireExecutions. A lease past its
  // expiry that expireExecutions hasn't ended yet still renews: no other
  // attempt can have started.
  renewExecution: (renew: {
    executionId: string;
    leaseMs: number;
  }) => Promise<
    | { ok: true; cancelRequested: boolean }
    | Refused<
        typeof Reason.invalid | typeof Reason.leaseLost | typeof Reason.timeout
      >
  >;
  // Ends the attempt and moves its task to a final state, judging the lease
  // as renewExecution does. The one who finishes it need not be the one who
  // started it. The answer is the state the task took, the reason recorded
  // with it, and the tasks the finish created.
  //
  // A finish as succeeded may carry the text of the file of tasks its run
  // left, JSON as tasksFileSchema reads it. Its tasks are created as the
  // task's children, recorded as the finisher's, and linked as the file
  // says, and each open task that waited for the task also waits for each
  // of the file's final tasks, those no other task in it waits for, all in
  // the same write. A file the graph can't take fails the task with a
  // reason that names what was wrong, and creates nothing: one that isn't
  // JSON or that tasksFileSchema refuses, a key two tasks have, a blocker no
  // task in it has or that one task names twice, links that close a cycle,
  // more than maxTasks tasks, or tasks that would sit deeper than maxDepth,
  // a task's depth being the number of parents above it. When someone asked
  // to cancel the task, a file that holds tasks, or doesn't read as a file,
  // cancels it instead, recorded as theirs. A blank text or a file with no
  // tasks creates nothing, and a finish as another state ignores its text.
  //
  // The same finish sent again, its answer lost, gets the same answer and
  // changes nothing: the attempt keeps a digest of the finish that ended it.
  finishTask: (
    finish: {
      executionId: string;
      changedBy: string;
      status: FinalStatus;
      // Why it ended so, recorded with the change; blank is null.
      reason?: string;
      // Where the run's result is, recorded on its attempt. Stored as given;
      // blank is null.
      resultPath?: string;
    } & (
      | { tasks: string; maxTasks: number; maxDepth: number }
      | { tasks?: undefined; maxTasks?: number; maxDepth?: number }
    ),
  ) => Promise<
    | {
        ok: true;
        status: FinalStatus;
        reason: string | null;
        created: CreatedTask[];
      }
    | Refused<
        typeof Reason.invalid | typeof Reason.leaseLost | typeof Reason.timeout
      >
  >;
  // Cancels an open task at once. For a running task, records the request on
  // its current attempt, which renewExecution reports to the one who runs
  // it; a second request changes nothing. status is the task's state after.
  // Refuses a task already in a final state, unless the cancellation that
  // ended it is its last change and came from the same one with the same
  // reason: that is the same cancel sent again, and it succeeds.
  cancelTask: (cancel: {
    id: string;
    changedBy: string;
    // Why, recorded with the change or the request; blank is null.
    reason?: string;
  }) => Promise<
    | { ok: true; status: typeof Status.cancelled | typeof Status.running }
    | Refused<
        | typeof Reason.invalid
        | typeof Reason.notFound
        | typeof Reason.alreadyFinished
        | typeof Reason.timeout
      >
  >;
  // Changes who may take an open task. Refuses a task that isn't open.
  assignTask: (assign: {
    id: string;
    assignee: string;
    changedBy: string;
  }) => Promise<
    | { ok: true }
    | Refused<
        | typeof Reason.invalid
        | typeof Reason.notFound
        | typeof Reason.notOpen
        | typeof Reason.timeout
      >
  >;
  // Ends every attempt whose lease expired. Its task is cancelled when
  // someone asked for it, recorded as theirs; else it opens again while the
  // attempt is below maxAttempts; else it fails. expired lists the attempts
  // it ended.
  expireExecutions: (expire: {
    maxAttempts: number;
    changedBy: string;
  }) => Promise<
    | { ok: true; expired: ExpiredExecution[] }
    | Refused<typeof Reason.invalid | typeof Reason.timeout>
  >;
  // The open tasks no blocker holds whose assignee is one of assignees,
  // matched exactly, most urgent first, then oldest, at most limit of them.
  listReady: (query: {
    assignees: string[];
    limit: number;
  }) => Promise<{ ok: true; tasks: Task[] } | Refused<typeof Reason.invalid>>;
}

// A write's transaction. Inside a write, every query runs on it: one on db,
// or prepared on it, would wait for the lock the transaction holds.
type Transaction = SQLiteAsyncTransaction<
  'async',
  TursoDatabaseRunResult,
  EmptyRelations
>;

// A task's columns, as Task has them.
const taskColumns = {
  id: tasks.id,
  title: tasks.title,
  kind: tasks.kind,
  priority: tasks.priority,
  parentId: tasks.parentId,
  assignee: tasks.assignee,
  description: tasks.description,
  sourcePath: tasks.sourcePath,
  context: tasks.context,
  uses: tasks.uses,
  status: tasks.status,
};

// Why a lease that ran out ended its attempt.
const leaseExpired = 'lease expired';

// Thrown out of a write's transaction, so that a refusal rolls it back.
class Refusal {
  constructor(readonly result: unknown) {}
}

function refuse<R extends Reason>(reason: R): Refused<R> {
  return { ok: false, reason };
}

// A new id: the prefix, an underscore and 32 hex digits.
function newId(prefix: string) {
  return `${prefix}_${randomBytes(16).toString('hex')}`;
}

function find(tx: Transaction, id: string) {
  return tx
    .select({ status: tasks.status })
    .from(tasks)
    .where(eq(tasks.id, id))
    .get();
}

// The ready tasks of these assignees: task_ready's condition, with one
// parameter per assignee. Turso searches that index once per assignee, then
// sorts only the rows it found; it scans the whole index for assignees read
// from a JSON array.
function readyFor(assignees: string[]) {
  return and(inArray(tasks.assignee, assignees), ready);
}

// Most urgent first, then oldest: rowid is the order of creation.
const readyOrder = [tasks.priority, sql`rowid`];

// The attempt that holds a lease: one that hasn't ended.
function leased(executionId: string) {
  return and(
    eq(taskExecutions.id, executionId),
    isNotNull(taskExecutions.expiresAt),
  );
}

// A task's count of holding blockers, one up or one down. The builder has no
// increment.
const oneMore = sql`${tasks.holdingBlockers} + 1`;
const oneLess = sql`${tasks.holdingBlockers} - 1`;

// Whether the second task is reachable from the first through open or
// cancelled blockers. A task cancelled while open keeps its links, and its
// blockers may still be open. Any other task was ready when it last started
// and takes no link while it isn't open, so its blockers all succeeded or
// were skipped: a path to an open task never runs through it. drizzle's
// builder has no recursive query.
function reaches(tx: Transaction, from: string, to: string) {
  return tx.get(sql`WITH RECURSIVE reached (id) AS (
  SELECT ${from}
  UNION
  SELECT ${taskLinks.blockerId} FROM reached
  JOIN ${taskLinks} ON ${taskLinks.taskId} = reached.id
  JOIN ${tasks} ON ${tasks.id} = ${taskLinks.blockerId} AND ${inArray(tasks.status, [Status.open, Status.cancelled])}
)
SELECT 1 FROM reached WHERE id = ${to} LIMIT 1`);
}

// How many parents sit above the task, up its chain of parent_id. A parent
// exists before its children, so the chain ends. A count answers one row.
function depth(tx: Transaction, taskId: string) {
  return tx.get(sql`WITH RECURSIVE above (id) AS (
  SELECT ${tasks.parentId} FROM ${tasks} WHERE ${tasks.id} = ${taskId}
  UNION ALL
  SELECT ${tasks.parentId} FROM above JOIN ${tasks} ON ${tasks.id} = above.id
)
SELECT count(id) AS depth FROM above`) as Promise<{ depth: number }>;
}

// A digest of a finish, as its schema outputs it, which its attempt keeps
// so the same finish sent again is told apart from any other.
function digest(finish: {
  changedBy: string;
  status: FinalStatus;
  reason: string | null;
  resultPath: string | null;
  tasks?: string;
}) {
  const { changedBy, status, reason, resultPath, tasks: text } = finish;
  return createHash('sha256')
    .update(JSON.stringify([changedBy, status, reason, resultPath, text]))
    .digest('hex');
}

// The tasks a file of tasks holds, or why the graph refuses it.
type FileRead = { ok: true; tasks: FileTask[] } | { ok: false; reason: string };

// The longest key or field name a reason quotes. A reason never quotes
// anything else of the file: it is the run's output, recorded and logged.
const longestQuoted = 64;

function refuseFile(why: string): FileRead {
  return { ok: false, reason: `tasks file: ${why}` };
}

// A task of the file, by its key when it is one and short, else by its
// position, from 1.
function named(key: unknown, index: number) {
  const parsed = fileTaskKeySchema.safeParse(key);
  return parsed.success && parsed.data.length <= longestQuoted
    ? `task ${JSON.stringify(parsed.data)}`
    : `task ${index + 1}`;
}

// What the first issue tasksFileSchema found says about the file.
function schemaRefusal(file: unknown, issue: z.core.$ZodIssue) {
  const [, index, field] = issue.path;
  const unknownField =
    issue.code === 'unrecognized_keys' && issue.keys[0].length <= longestQuoted
      ? `has the unknown field ${JSON.stringify(issue.keys[0])}`
      : 'has an unknown field';
  if (typeof index !== 'number') {
    return issue.code === 'unrecognized_keys'
      ? unknownField
      : 'not an object with a list of tasks';
  }
  const task = (file as { tasks: { key?: unknown }[] }).tasks[index];
  const name = named(task?.key, index);
  if (field === undefined) {
    return issue.code === 'unrecognized_keys'
      ? `${name} ${unknownField}`
      : `${name} is not an object`;
  }
  return `${name} has no valid ${String(field)}`;
}

// The position of the first task, in the file's order, on a cycle of the
// file's links, or -1 when no link closes one. Every blocker names a task of
// the file, once.
function onCycle(file: FileTask[]) {
  // How many of its blockers each task still waits for, freed in turn from
  // the tasks that wait for none: those never freed wait, through their
  // links, for a cycle.
  const waiting = new Map(
    file.map((task) => [task.key, task.blockedBy?.length ?? 0]),
  );
  const free = file.filter((task) => waiting.get(task.key) === 0);
  for (let next = free.pop(); next !== undefined; next = free.pop()) {
    waiting.delete(next.key);
    for (const task of file) {
      if (task.blockedBy?.includes(next.key)) {
        const left = (waiting.get(task.key) as number) - 1;
        waiting.set(task.key, left);
        if (left === 0) {
          free.push(task);
        }
      }
    }
  }
  if (waiting.size === 0) {
    return -1;
  }
  // Each task left waits for another left: following them from the first
  // comes back to a task on a cycle.
  const byKey = new Map(file.map((task, index) => [task.key, index]));
  const seen = new Set<string>();
  let [key] = waiting.keys();
  while (!seen.has(key)) {
    seen.add(key);
    const { blockedBy } = file[byKey.get(key) as number];
    key = (blockedBy as string[]).find((blocker) =>
      waiting.has(blocker),
    ) as string;
  }
  return byKey.get(key) as number;
}

// Reads a file of tasks, refusing one with more than maxTasks tasks or any
// the graph can't create as the file says. A blank text holds no tasks.
function readTasksFile(text: string, maxTasks: number): FileRead {
  if (text.trim() === '') {
    return { ok: true, tasks: [] };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // The parser's message quotes the text.
    return refuseFile('not JSON');
  }
  const parsed = tasksFileSchema.safeParse(value);
  if (!parsed.success) {
    return refuseFile(schemaRefusal(value, parsed.error.issues[0]));
  }
  const file = parsed.data.tasks;
  if (file.length > maxTasks) {
    return refuseFile(
      `${file.length} tasks, more than the limit of ${maxTasks}`,
    );
  }
  const keys = new Set<string>();
  for (const [index, task] of file.entries()) {
    if (keys.has(task.key)) {
      return refuseFile(
        `${named(task.key, index)} repeats the key of an earlier task`,
      );
    }
    keys.add(task.key);
  }
  for (const [index, task] of file.entries()) {
    const blockers = task.blockedBy ?? [];
    if (blockers.some((blocker) => !keys.has(blocker))) {
      return refuseFile(
        `${named(task.key, index)} waits for a key no task in the file has`,
      );
    }
    if (new Set(blockers).size < blockers.length) {
      return refuseFile(
        `${named(task.key, index)} waits for the same key twice`,
      );
    }
  }
  const cycle = onCycle(file);
  if (cycle !== -1) {
    return refuseFile(
      `${named(file[cycle].key, cycle)} waits for itself through its links`,
    );
  }
  return { ok: true, tasks: file };
}

// One level of a logger: a message, or fields and then a message.
interface LogMethod {
  (msg: string): void;
  (fields: object, msg?: string): void;
}

// The logger the graph writes through, by the methods it would call, so the
// package needs no logging library: a Pino logger is one.
export interface Logger {
  fatal: LogMethod;
  error: LogMethod;
  warn: LogMethod;
  info: LogMethod;
  debug: LogMethod;
  trace: LogMethod;
}

// The graph's operations over a migrated database. Readiness is kept in each
// task's holding_blockers, which every write moves in the same transaction:
// it always counts the task's blockers that hold it. The logger is there for
// the graph's code; nothing in it logs yet. now is the clock every recorded
// time, lease and timeout reads; timeoutMs is how long a write may take,
// waiting for the lock included, with no limit when undefined.
export function createGraph(
  db: TursoDatabaseDatabase,
  _logger: Logger,
  now: () => number,
  timeoutMs?: number,
): Graph {
  // Runs fn in an immediate transaction, which takes the write lock first, so
  // its checks and its writes see the same graph. Turso holds the connection
  // until the transaction ends: another operation waits for it. A refusal is
  // thrown out of the transaction, so only a success commits. The deadline is
  // checked once the lock is taken and again before the commit: a write past
  // it rolls back as timeout instead of committing for a caller that gave up.
  async function write<T extends { ok: boolean }>(
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T | Refused<typeof Reason.timeout>> {
    const deadline = timeoutMs === undefined ? Infinity : now() + timeoutMs;
    const inTime = () => {
      if (now() > deadline) {
        throw new Refusal(refuse(Reason.timeout));
      }
    };
    try {
      return await db.transaction(
        async (tx) => {
          inTime();
          const result = await fn(tx);
          if (!result.ok) {
            throw new Refusal(result);
          }
          inTime();
          return result;
        },
        { behavior: 'immediate' },
      );
    } catch (error) {
      if (error instanceof Refusal) {
        return error.result as T | Refused<typeof Reason.timeout>;
      }
      throw error;
    }
  }

  // Records a change of a task's status, now, inside the caller's write.
  async function recordChange(
    tx: Transaction,
    taskId: string,
    fromStatus: Status | null,
    toStatus: Status,
    changedBy: string,
    reason: string | null = null,
  ) {
    await tx.insert(taskStatusChanges).values({
      taskId,
      fromStatus,
      toStatus,
      changedBy,
      reason,
      timeChanged: now(),
    });
  }

  // Moves a task from one status to another and records the change.
  async function move(
    tx: Transaction,
    taskId: string,
    fromStatus: Status,
    toStatus: Status,
    changedBy: string,
    reason: string | null = null,
  ) {
    await tx
      .update(tasks)
      .set({ status: toStatus })
      .where(eq(tasks.id, taskId));
    await recordChange(tx, taskId, fromStatus, toStatus, changedBy, reason);
  }

  // Moves a ready task to running and starts its next attempt, run by the
  // actor under its claim.
  async function begin(
    tx: Transaction,
    {
      taskId,
      claimId,
      actor,
      leaseMs,
    }: { taskId: string; claimId: string; actor: string; leaseMs: number },
  ): Promise<Execution> {
    const last = await tx
      .select({ attempt: max(taskExecutions.attempt) })
      .from(taskExecutions)
      .where(eq(taskExecutions.taskId, taskId))
      .get();
    const execution: Execution = {
      id: newId('exe'),
      attempt: (last?.attempt ?? 0) + 1,
      expiresAt: now() + leaseMs,
    };
    await move(tx, taskId, Status.open, Status.running, actor);
    await tx
      .insert(taskExecutions)
      .values({ ...execution, taskId, claimId, actor });
    return execution;
  }

  // Answers a claim sent again while its attempt runs: the same task and
  // attempt, its lease pushed to leaseMs from now.
  async function again(
    tx: Transaction,
    claimed: { id: string; taskId: string; attempt: number },
    leaseMs: number,
  ) {
    const execution: Execution = {
      id: claimed.id,
      attempt: claimed.attempt,
      expiresAt: now() + leaseMs,
    };
    await tx
      .update(taskExecutions)
      .set({ expiresAt: execution.expiresAt })
      .where(eq(taskExecutions.id, claimed.id));
    // An attempt's task exists: its foreign key says so.
    const task = (await tx
      .select(taskColumns)
      .from(tasks)
      .where(eq(tasks.id, claimed.taskId))
      .get()) as Task;
    return { ok: true as const, task, execution };
  }

  // A task's last change of status.
  function lastChange(tx: Transaction, taskId: string) {
    return tx
      .select({
        fromStatus: taskStatusChanges.fromStatus,
        toStatus: taskStatusChanges.toStatus,
        changedBy: taskStatusChanges.changedBy,
        reason: taskStatusChanges.reason,
      })
      .from(taskStatusChanges)
      .where(eq(taskStatusChanges.taskId, taskId))
      .orderBy(desc(taskStatusChanges.id))
      .limit(1)
      .get();
  }

  // Ends a running task's attempt: in a final state, or back in open when
  // its lease expired with attempts left, which holds the tasks it blocks as
  // running did. The tasks it blocks are open or cancelled: a task it held
  // never started since.
  async function end(
    tx: Transaction,
    attempt: {
      taskId: string;
      executionId: string;
      status: FinalStatus | typeof Status.open;
      changedBy: string;
      reason: string | null;
      resultPath?: string | null;
      // The digest of the finish that ends it, when one does.
      finishDigest?: string;
    },
  ) {
    const {
      taskId,
      executionId,
      status,
      changedBy,
      reason,
      resultPath,
      finishDigest,
    } = attempt;
    await move(tx, taskId, Status.running, status, changedBy, reason);
    await tx
      .update(taskExecutions)
      .set({ expiresAt: null, resultPath, finishDigest })
      .where(eq(taskExecutions.id, executionId));
    if (!holds(status)) {
      await tx
        .update(tasks)
        .set({ holdingBlockers: oneLess })
        .where(
          inArray(
            tasks.id,
            tx
              .select({ taskId: taskLinks.taskId })
              .from(taskLinks)
              .where(eq(taskLinks.blockerId, taskId)),
          ),
        );
    }
  }

  // Creates the tasks of a file as the children of the task whose run left
  // it, recorded as the creator's and under their keys as the attempt's,
  // then links them as the file says. Each blocker is a task of the file,
  // new and open, so it holds: each task starts held by all of its own.
  async function createFileTasks(
    tx: Transaction,
    {
      taskId,
      executionId,
      createdBy,
    }: { taskId: string; executionId: string; createdBy: string },
    file: FileTask[],
  ) {
    const created: CreatedTask[] = [];
    for (const { key, source, blockedBy = [], ...fields } of file) {
      const id = newId('tsk');
      await tx.insert(tasks).values({
        id,
        ...fields,
        sourcePath: source,
        parentId: taskId,
        status: Status.open,
        holdingBlockers: blockedBy.length,
      });
      await recordChange(tx, id, null, Status.open, createdBy);
      await tx
        .insert(taskExecutionTasks)
        .values({ executionId, key, taskId: id });
      created.push({ key, id });
    }
    const ids = new Map(created.map(({ key, id }) => [key, id]));
    for (const { key, blockedBy = [] } of file) {
      for (const blocker of blockedBy) {
        await tx.insert(taskLinks).values({
          taskId: ids.get(key) as string,
          blockerId: ids.get(blocker) as string,
        });
      }
    }
    return created;
  }

  // Makes each open task the finishing task blocks wait for the file's final
  // tasks too, those no other task of the file waits for. A cancelled one
  // keeps its links and gets none.
  async function handOver(
    tx: Transaction,
    taskId: string,
    file: FileTask[],
    created: CreatedTask[],
  ) {
    // Stryker disable next-line ArrayDeclaration: a key no task has waits for nothing either
    const waitedFor = new Set(file.flatMap((task) => task.blockedBy ?? []));
    const finals = created.filter(({ key }) => !waitedFor.has(key));
    const dependents = await tx
      .select({ id: tasks.id })
      .from(taskLinks)
      .innerJoin(tasks, eq(tasks.id, taskLinks.taskId))
      .where(
        and(eq(taskLinks.blockerId, taskId), eq(tasks.status, Status.open)),
      );
    for (const dependent of dependents) {
      for (const final of finals) {
        await tx
          .insert(taskLinks)
          .values({ taskId: dependent.id, blockerId: final.id });
      }
      await tx
        .update(tasks)
        .set({
          holdingBlockers: sql`${tasks.holdingBlockers} + ${finals.length}`,
        })
        .where(eq(tasks.id, dependent.id));
    }
  }

  // The answer of the finish that ended the attempt: the change that ended
  // it, its task's last since the task is final, and the tasks it created,
  // in the file's order.
  async function answered(
    tx: Transaction,
    taskId: string,
    executionId: string,
  ) {
    const last = (await lastChange(tx, taskId)) as {
      toStatus: FinalStatus;
      reason: string | null;
    };
    const created = await tx
      .select({ key: taskExecutionTasks.key, id: taskExecutionTasks.taskId })
      .from(taskExecutionTasks)
      .where(eq(taskExecutionTasks.executionId, executionId))
      .orderBy(sql`rowid`);
    return {
      ok: true as const,
      status: last.toStatus,
      reason: last.reason,
      created,
    };
  }

  return {
    createTask: async (input) => {
      const parsed = createTaskSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { parentId, createdBy, ...fields } = parsed.data;
      return write(async (tx) => {
        if (
          parentId !== undefined &&
          (await find(tx, parentId)) === undefined
        ) {
          return refuse(Reason.notFound);
        }
        const task: Task = {
          id: newId('tsk'),
          ...fields,
          parentId: parentId ?? null,
          status: Status.open,
        };
        await tx.insert(tasks).values(task);
        await recordChange(tx, task.id, null, Status.open, createdBy);
        return { ok: true, task };
      });
    },

    link: async (input) => {
      const parsed = linkSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { taskId, blockerId } = parsed.data;
      return write(async (tx) => {
        const task = await find(tx, taskId);
        const blocker = await find(tx, blockerId);
        if (task === undefined || blocker === undefined) {
          return refuse(Reason.notFound);
        }
        if (taskId === blockerId) {
          return refuse(Reason.sameTask);
        }
        const linked = await tx
          .select({ taskId: taskLinks.taskId })
          .from(taskLinks)
          .where(
            and(
              eq(taskLinks.taskId, taskId),
              eq(taskLinks.blockerId, blockerId),
            ),
          )
          .get();
        if (linked !== undefined) {
          return { ok: true };
        }
        if (task.status !== Status.open) {
          return refuse(Reason.notOpen);
        }
        if ((await reaches(tx, blockerId, taskId)) !== undefined) {
          return refuse(Reason.cycle);
        }
        if (holds(blocker.status)) {
          await tx
            .update(tasks)
            .set({ holdingBlockers: oneMore })
            .where(eq(tasks.id, taskId));
        }
        await tx.insert(taskLinks).values({ taskId, blockerId });
        return { ok: true };
      });
    },

    unlink: async (input) => {
      const parsed = unlinkSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { taskId, blockerId } = parsed.data;
      return write(async (tx) => {
        const task = await find(tx, taskId);
        const blocker = await find(tx, blockerId);
        if (task === undefined || blocker === undefined) {
          return refuse(Reason.notFound);
        }
        if (task.status !== Status.open) {
          return refuse(Reason.notOpen);
        }
        const { changes } = await tx
          .delete(taskLinks)
          .where(
            and(
              eq(taskLinks.taskId, taskId),
              eq(taskLinks.blockerId, blockerId),
            ),
          );
        if (changes > 0 && holds(blocker.status)) {
          await tx
            .update(tasks)
            .set({ holdingBlockers: oneLess })
            .where(eq(tasks.id, taskId));
        }
        return { ok: true };
      });
    },

    claimTask: async (input) => {
      const parsed = claimTaskSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { claimId, assignees, actor, leaseMs } = parsed.data;
      return write(async (tx) => {
        const claimed = await tx
          .select({
            id: taskExecutions.id,
            taskId: taskExecutions.taskId,
            attempt: taskExecutions.attempt,
            expiresAt: taskExecutions.expiresAt,
          })
          .from(taskExecutions)
          .where(
            and(
              eq(taskExecutions.actor, actor),
              eq(taskExecutions.claimId, claimId),
            ),
          )
          .get();
        if (claimed !== undefined) {
          return claimed.expiresAt === null
            ? { ok: true, task: null }
            : again(tx, claimed, leaseMs);
        }
        const task = await tx
          .select(taskColumns)
          .from(tasks)
          .where(readyFor(assignees))
          .orderBy(...readyOrder)
          .limit(1)
          .get();
        if (task === undefined) {
          return { ok: true, task: null };
        }
        const execution = await begin(tx, {
          taskId: task.id,
          claimId,
          actor,
          leaseMs,
        });
        return {
          ok: true,
          task: { ...task, status: Status.running },
          execution,
        };
      });
    },

    renewExecution: async (input) => {
      const parsed = renewExecutionSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { executionId, leaseMs } = parsed.data;
      // One statement, since every runner sends one every few seconds.
      return write(async (tx) => {
        const execution = await tx
          .update(taskExecutions)
          .set({ expiresAt: now() + leaseMs })
          .where(leased(executionId))
          .returning({ cancelRequestedBy: taskExecutions.cancelRequestedBy })
          .get();
        if (execution === undefined) {
          return refuse(Reason.leaseLost);
        }
        return {
          ok: true,
          cancelRequested: execution.cancelRequestedBy !== null,
        };
      });
    },

    finishTask: async (input) => {
      const parsed = finishTaskSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const finish = parsed.data;
      const { executionId, changedBy, status, reason, resultPath } = finish;
      const finishDigest = digest(finish);
      return write(async (tx) => {
        const execution = await tx
          .select({
            taskId: taskExecutions.taskId,
            expiresAt: taskExecutions.expiresAt,
            cancelRequestedBy: taskExecutions.cancelRequestedBy,
            cancelReason: taskExecutions.cancelReason,
            finishDigest: taskExecutions.finishDigest,
          })
          .from(taskExecutions)
          .where(eq(taskExecutions.id, executionId))
          .get();
        if (execution === undefined) {
          return refuse(Reason.leaseLost);
        }
        const { taskId } = execution;
        if (execution.expiresAt === null) {
          // The attempt ended: by this same finish, whose answer was lost,
          // when the digests match. A finish leaves its task final, so its
          // end stays the task's last change, and its attempt the latest;
          // the sweep keeps no digest.
          return execution.finishDigest === finishDigest
            ? answered(tx, taskId, executionId)
            : refuse(Reason.leaseLost);
        }
        const ended = async (
          to: FinalStatus,
          by: string,
          why: string | null,
          created: CreatedTask[] = [],
        ) => {
          await end(tx, {
            taskId,
            executionId,
            status: to,
            changedBy: by,
            reason: why,
            resultPath,
            finishDigest,
          });
          return { ok: true as const, status: to, reason: why, created };
        };
        if (status !== Status.succeeded || finish.tasks === undefined) {
          return ended(status, changedBy, reason);
        }
        const file = readTasksFile(finish.tasks, finish.maxTasks);
        if (file.ok && file.tasks.length === 0) {
          return ended(status, changedBy, reason);
        }
        // A cancellation asked for wins over a file that would start more.
        if (execution.cancelRequestedBy !== null) {
          return ended(
            Status.cancelled,
            execution.cancelRequestedBy,
            execution.cancelReason,
          );
        }
        if (!file.ok) {
          return ended(Status.failed, changedBy, file.reason);
        }
        // The file's tasks sit one level below the task.
        const above = await depth(tx, taskId);
        if (above.depth + 1 > finish.maxDepth) {
          return ended(
            Status.failed,
            changedBy,
            `tasks file: its tasks would sit deeper than the limit of ${finish.maxDepth}`,
          );
        }
        const created = await createFileTasks(
          tx,
          { taskId, executionId, createdBy: changedBy },
          file.tasks,
        );
        await handOver(tx, taskId, file.tasks, created);
        return ended(status, changedBy, reason, created);
      });
    },

    cancelTask: async (input) => {
      const parsed = cancelTaskSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { id, changedBy, reason } = parsed.data;
      return write(async (tx) => {
        const task = await find(tx, id);
        if (task === undefined) {
          return refuse(Reason.notFound);
        }
        if (task.status === Status.open) {
          // Cancelled holds the tasks it blocks, as open did: no counter
          // moves.
          await move(tx, id, Status.open, Status.cancelled, changedBy, reason);
          return { ok: true, status: Status.cancelled };
        }
        if (task.status === Status.running) {
          await tx
            .update(taskExecutions)
            .set({ cancelRequestedBy: changedBy, cancelReason: reason })
            .where(
              and(
                eq(taskExecutions.taskId, id),
                isNotNull(taskExecutions.expiresAt),
                isNull(taskExecutions.cancelRequestedBy),
              ),
            );
          return { ok: true, status: Status.running };
        }
        // The same cancel sent again, its answer lost: the cancellation is
        // the task's last change, by the same one for the same reason.
        const last = await lastChange(tx, id);
        const same =
          last?.toStatus === Status.cancelled &&
          last.changedBy === changedBy &&
          last.reason === reason;
        return same
          ? { ok: true, status: Status.cancelled }
          : refuse(Reason.alreadyFinished);
      });
    },

    assignTask: async (input) => {
      const parsed = assignTaskSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { id, assignee } = parsed.data;
      return write(async (tx) => {
        const task = await find(tx, id);
        if (task === undefined) {
          return refuse(Reason.notFound);
        }
        if (task.status !== Status.open) {
          return refuse(Reason.notOpen);
        }
        await tx.update(tasks).set({ assignee }).where(eq(tasks.id, id));
        return { ok: true };
      });
    },

    expireExecutions: async (input) => {
      const parsed = expireExecutionsSchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { maxAttempts, changedBy } = parsed.data;
      // The attempts whose lease ran out by now. The condition holds
      // task_execution_lease's, so Turso searches it.
      const due = () =>
        and(
          isNotNull(taskExecutions.expiresAt),
          lte(taskExecutions.expiresAt, now()),
        );
      // A read first, which takes no write lock: most sweeps find nothing.
      const any = await db
        .select({ id: taskExecutions.id })
        .from(taskExecutions)
        .where(due())
        .limit(1)
        .get();
      if (any === undefined) {
        return { ok: true, expired: [] };
      }
      return write(async (tx) => {
        const ending = await tx
          .select({
            id: taskExecutions.id,
            taskId: taskExecutions.taskId,
            attempt: taskExecutions.attempt,
            cancelRequestedBy: taskExecutions.cancelRequestedBy,
            cancelReason: taskExecutions.cancelReason,
          })
          .from(taskExecutions)
          .where(due());
        const expired: ExpiredExecution[] = [];
        for (const execution of ending) {
          const attempt = {
            taskId: execution.taskId,
            executionId: execution.id,
          };
          if (execution.cancelRequestedBy !== null) {
            await end(tx, {
              ...attempt,
              status: Status.cancelled,
              changedBy: execution.cancelRequestedBy,
              reason: execution.cancelReason,
            });
            expired.push({
              ...attempt,
              attempt: execution.attempt,
              status: Status.cancelled,
            });
          } else {
            // Back to open while attempts are left. It was ready when it
            // started, and no link reaches a task past open, so it is ready
            // again.
            const status =
              execution.attempt < maxAttempts ? Status.open : Status.failed;
            await end(tx, {
              ...attempt,
              status,
              changedBy,
              reason: leaseExpired,
            });
            expired.push({ ...attempt, attempt: execution.attempt, status });
          }
        }
        return { ok: true, expired };
      });
    },

    // Waits for a write in progress, so it reads the graph between writes.
    listReady: async (input) => {
      const parsed = listReadySchema.safeParse(input);
      if (!parsed.success) {
        return refuse(Reason.invalid);
      }
      const { assignees, limit } = parsed.data;
      const rows = await db
        .select(taskColumns)
        .from(tasks)
        .where(readyFor(assignees))
        .orderBy(...readyOrder)
        .limit(limit);
      return { ok: true, tasks: rows };
    },
  };
}
