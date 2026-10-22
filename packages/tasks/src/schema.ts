import { type SQL, sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { Status, statusList } from './status';

// The task graph's tables. A change here needs a migration, generated from
// this file: `pnpm --filter @sextou/tasks exec drizzle-kit generate --name
// <change>`. Never edit a generated migration: a database that already
// applied it never runs the edit.
//
// Every check and index condition is literal SQL. drizzle-kit writes a value
// interpolated into one as a bound parameter, which DDL can't take.
//
// tasks, task_links and task_executions keep their rowid: Turso has WITHOUT
// ROWID only as an experiment, with no DELETE, UPDATE, foreign key or second
// index.

// holding_blockers counts the task's blockers that still hold it: those open,
// running or failed. A ready task is then one row of task_ready, which no
// other index covers: with a second candidate, SQLite can pick the wrong one.
// The index orders by assignee, then by priority, then by rowid, which is the
// order the tasks were created in. Turso searches it only for a query that
// writes the status and the count as literals, as its condition does: the
// ready list writes the same condition, ready.
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
    status: text('status').$type<Status>().notNull(),
    holdingBlockers: integer('holding_blockers').notNull().default(0),
  },
  (table) => [
    check('task_priority', sql`${table.priority} BETWEEN 0 AND 4`),
    check('task_status', sql`${table.status} IN (${sql.raw(statusList)})`),
    check('task_holding_blockers', sql`${table.holdingBlockers} >= 0`),
    index('task_ready').on(table.assignee, table.priority).where(ready),
  ],
);

// The open status as literal SQL.
export const openStatus = sql.raw(`'${Status.open}'`);

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

// Who runs a started task and where its log and result are; its start and
// end are the changes into and out of running. Nothing reads it yet, so it
// has no index beyond its key.
export const taskExecutions = sqliteTable('task_executions', {
  taskId: text('task_id')
    .primaryKey()
    .references(() => tasks.id),
  actor: text('actor').notNull(),
  logPath: text('log_path'),
  resultPath: text('result_path'),
});
