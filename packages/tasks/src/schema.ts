import { type SQL, sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { Context } from './schemas';
import { Status, statusList } from './status';

// The task graph's tables. A change here needs a migration, generated from
// this file: `pnpm --filter @sextou/tasks exec drizzle-kit generate --name
// <change>`. Never edit a generated migration: a database that already
// applied it never runs the edit.
//
// Every check and index condition is literal SQL. drizzle-kit writes a value
// interpolated into one as a bound parameter, which DDL can't take.
//
// Every table keeps its rowid: Turso has WITHOUT ROWID only as an experiment,
// with no DELETE, UPDATE, foreign key or second index.

// holding_blockers counts the task's blockers that still hold it: those open,
// running, failed or cancelled. A ready task is then one row of task_ready,
// which no other index covers: with a second candidate, SQLite can pick the
// wrong one. The index orders by assignee, then by priority, then by rowid,
// which is the order the tasks were created in. Turso searches it only for a
// query that writes the status and the count as literals, as its condition
// does: the ready list writes the same condition, ready.
//
// context is a JSON object the caller stores with the task, as text: drizzle
// writes and reads it as JSON. Its check reads the type only once the text is
// JSON: Turso evaluates both sides of an AND, and json_type fails on text that
// is not JSON.
//
// uses names the Taskfile a runner runs for the task, as the caller gave it:
// owner/name/path/to/Taskfile.yml@sha. No query filters by it, so it has no
// index.
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    kind: text('kind').notNull(),
    priority: integer('priority').notNull(),
    parentId: text('parent_id').references((): AnySQLiteColumn => tasks.id),
    assignee: text('assignee').notNull(),
    description: text('description'),
    sourcePath: text('source_path'),
    context: text('context', { mode: 'json' }).$type<Context>(),
    uses: text('uses'),
    status: text('status').$type<Status>().notNull(),
    holdingBlockers: integer('holding_blockers').notNull().default(0),
  },
  (table) => [
    check('task_priority', sql`${table.priority} BETWEEN 0 AND 4`),
    check('task_status', sql`${table.status} IN (${sql.raw(statusList)})`),
    check('task_holding_blockers', sql`${table.holdingBlockers} >= 0`),
    check(
      'task_context',
      sql`CASE WHEN json_valid(${table.context}) THEN json_type(${table.context}) = 'object' ELSE ${table.context} IS NULL END`,
    ),
    index('task_ready').on(table.assignee, table.priority).where(ready),
  ],
);

// The open status as literal SQL.
const openStatus = sql.raw(`'${Status.open}'`);

// An open task no blocker holds: task_ready's condition.
export const ready: SQL = sql`${tasks.status} = ${openStatus} AND ${tasks.holdingBlockers} = 0`;

// task_link_blocker finds the tasks a finishing task blocks.
export const taskLinks = sqliteTable(
  'task_links',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    blockerId: text('blocker_id')
      .notNull()
      .references(() => tasks.id),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.blockerId] }),
    index('task_link_blocker').on(table.blockerId),
  ],
);

// Each change of a task's status, its creation first; its own key keeps
// changes in the same millisecond in order. Nothing reads it yet, so it has
// no index beyond its key.
export const taskStatusChanges = sqliteTable(
  'task_status_changes',
  {
    id: integer('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    fromStatus: text('from_status').$type<Status>(),
    toStatus: text('to_status').$type<Status>().notNull(),
    changedBy: text('changed_by').notNull(),
    reason: text('reason'),
    timeChanged: integer('time_changed').notNull(),
  },
  (table) => [
    check(
      'task_status_change_from_status',
      sql`${table.fromStatus} IN (${sql.raw(statusList)})`,
    ),
    check(
      'task_status_change_to_status',
      sql`${table.toStatus} IN (${sql.raw(statusList)})`,
    ),
  ],
);

// Each attempt at running a task: who runs it, under which of its claims,
// where its log and result are, and its lease. Its start and end are the
// changes into and out of running. The id is the token the one who runs it
// carries. An actor names each claim once, so a claim sent again finds its
// attempt through task_execution_claim.
//
// expires_at is set only while the attempt runs, so only a task's current
// attempt has one, and task_execution_lease finds the expired ones. A
// cancellation asked for while it runs is recorded here until it ends.
// A task's attempts are numbered from 1, once each.
//
// finish_digest is set only once the attempt ends: a digest of the finish
// that ended it, so the same finish sent again is told apart from another.
export const taskExecutions = sqliteTable(
  'task_executions',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    attempt: integer('attempt').notNull(),
    actor: text('actor').notNull(),
    claimId: text('claim_id').notNull(),
    logPath: text('log_path'),
    resultPath: text('result_path'),
    expiresAt: integer('expires_at'),
    cancelRequestedBy: text('cancel_requested_by'),
    cancelReason: text('cancel_reason'),
    finishDigest: text('finish_digest'),
  },
  (table) => [
    check('task_execution_attempt', sql`${table.attempt} >= 1`),
    uniqueIndex('task_execution_task_attempt').on(table.taskId, table.attempt),
    uniqueIndex('task_execution_claim').on(table.actor, table.claimId),
    index('task_execution_lease')
      .on(table.expiresAt)
      .where(sql`${table.expiresAt} IS NOT NULL`),
  ],
);

// The tasks an attempt's finish created, each under the key the attempt's
// file of tasks gave it, so the same finish sent again answers with them.
// A task is created by one finish, under one key.
export const taskExecutionTasks = sqliteTable(
  'task_execution_tasks',
  {
    executionId: text('execution_id')
      .notNull()
      .references(() => taskExecutions.id),
    key: text('key').notNull(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
  },
  (table) => [
    primaryKey({ columns: [table.executionId, table.key] }),
    uniqueIndex('task_execution_task_created').on(table.taskId),
  ],
);
