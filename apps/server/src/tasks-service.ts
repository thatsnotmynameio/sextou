import {
  type Context,
  type Logger,
  openTasks,
  splitUses,
  type Task as StoredTask,
  type Tasks as TasksDb,
} from '@sextou/tasks';
import type {
  Actor,
  ExpiredAttempt,
  Priority,
  Refusal,
  Refused,
  Task,
  Tasks,
} from './tasks';

// The server's tasks service: the only code that talks to @sextou/tasks, and
// only main.ts creates it. Its types are tasks.ts's, not the library's: the
// conversions below fail to compile when the library drifts from them.

export interface TasksService extends Tasks {
  // Opens the tasks database. When it can't, it rejects, and so does every
  // call after it until the server restarts.
  start: () => Promise<void>;
  // Closes the tasks database; does nothing when it never opened.
  stop: () => Promise<void>;
  // Ends every attempt whose lease expired, as the actor: its task opens
  // again while attempts are left, else fails, or is cancelled when someone
  // asked for it. expired lists the attempts it ended.
  expire: (
    actor: Actor,
  ) => Promise<
    | { ok: true; expired: ExpiredAttempt[] }
    | Refused<typeof Refusal.invalid | typeof Refusal.timeout>
  >;
}

export interface TasksServiceOptions {
  // Where the tasks database logs: the server's logger.
  logger: Logger;
  // Where @sextou/tasks' migrations are, when not in the package itself: the
  // copy the production bundle carries.
  migrationsFolder?: string;
  // How long a runner's lease lasts unless renewed, in milliseconds.
  leaseMs: number;
  // How many attempts a task gets before an expired lease fails it.
  maxAttempts: number;
  // How long a call to the tasks database may take, in milliseconds: one
  // past it writes nothing and is refused as timeout.
  timeoutMs: number;
}

// The service over the tasks database at an absolute path, or in memory for
// ':memory:'. Nothing opens until start.
export function createTasksService(
  path: string,
  {
    logger,
    migrationsFolder,
    leaseMs,
    maxAttempts,
    timeoutMs,
  }: TasksServiceOptions,
): TasksService {
  let database: Promise<TasksDb> | undefined;

  const opened = () =>
    database ?? Promise.reject(new Error('The tasks service is not started'));

  return {
    start: async () => {
      database ??= openTasks(path, { logger, migrationsFolder, timeoutMs });
      await database;
    },
    stop: async () => {
      await database?.then(
        (tasks) => tasks.close(),
        () => undefined,
      );
    },
    create: async (task) => {
      const result = await (
        await opened()
      ).createTask({
        title: task.title,
        kind: task.kind,
        priority: task.priority,
        parentId: task.parentId,
        assignee: task.assignee.name,
        description: task.description,
        sourcePath: task.source,
        // The library refuses a context that isn't a JSON object as invalid.
        context: task.context as Context | undefined,
        uses: task.uses,
        createdBy: task.createdBy.name,
      });
      return result.ok
        ? { ok: true, task: toTask(result.task) }
        : refused(result.reason);
    },
    claim: async ({ claimId, runner, assignees }) => {
      const result = await (
        await opened()
      ).claimTask({
        claimId,
        assignees: assignees.map((assignee) => assignee.name),
        actor: runner.name,
        leaseMs,
      });
      if (!result.ok) {
        return refused(result.reason);
      }
      if (result.task === null) {
        return { ok: true, task: null };
      }
      const { id, attempt } = result.execution;
      const { uses } = result.task;
      return {
        ok: true,
        task: toTask(result.task),
        // The tasks stored only a uses they split.
        // Stryker disable next-line ConditionalExpression: splitUses answers null for null too
        uses: uses === null ? null : splitUses(uses),
        execution: { id, attempt, leaseMs },
      };
    },
    renew: async (executionId) => {
      const result = await (
        await opened()
      ).renewExecution({ executionId, leaseMs });
      return result.ok
        ? { ok: true, cancel: result.cancelRequested, leaseMs }
        : refused(result.reason);
    },
    finish: async ({ executionId, runner, outcome, reason }) => {
      const result = await (
        await opened()
      ).finishTask({
        executionId,
        changedBy: runner.name,
        status: outcome,
        reason,
      });
      return result.ok ? { ok: true } : refused(result.reason);
    },
    cancel: async ({ taskId, actor, reason }) => {
      const result = await (
        await opened()
      ).cancelTask({ id: taskId, changedBy: actor.name, reason });
      return result.ok
        ? { ok: true, status: result.status }
        : refused(result.reason);
    },
    assign: async ({ taskId, assignee, actor }) => {
      const result = await (
        await opened()
      ).assignTask({
        id: taskId,
        assignee: assignee.name,
        changedBy: actor.name,
      });
      return result.ok ? { ok: true } : refused(result.reason);
    },
    expire: async (actor) => {
      const result = await (
        await opened()
      ).expireExecutions({ maxAttempts, changedBy: actor.name });
      return result.ok
        ? { ok: true, expired: result.expired }
        : refused(result.reason);
    },
  };
}

function refused<R extends Refusal>(refusal: R): Refused<R> {
  return { ok: false, refusal };
}

function toTask(task: StoredTask): Task {
  return {
    id: task.id,
    title: task.title,
    kind: task.kind,
    // The library refuses a priority outside 0 to 4.
    priority: task.priority as Priority,
    parentId: task.parentId,
    assignee: { name: task.assignee },
    description: task.description,
    source: task.sourcePath,
    context: task.context,
    uses: task.uses,
    status: task.status,
  };
}
