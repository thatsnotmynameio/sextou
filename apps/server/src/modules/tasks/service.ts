import { openTasks, type Task as StoredTask, type Tasks } from '@sextou/tasks';

// The server's tasks: the only code that talks to @sextou/tasks, and only
// main.ts creates it. Its types are its own, not the library's: the
// conversions below fail to compile when the library drifts from them.

// Who acts: a person or an agent, by name.
export interface Actor {
  name: string;
}

// 0 is the most urgent, 4 the least.
export type Priority = 0 | 1 | 2 | 3 | 4;

export type Status = 'open' | 'running' | 'succeeded' | 'failed' | 'skipped';

// How a task ends.
export type Outcome = 'succeeded' | 'failed' | 'skipped';

export interface Task {
  id: string;
  title: string;
  kind: string;
  priority: Priority;
  parentId: string | null;
  assignee: Actor;
  description: string | null;
  // A URL or a file path where the task's longer text lives.
  source: string | null;
  status: Status;
}

export interface NewTask {
  title: string;
  kind: string;
  priority: Priority;
  parentId?: string;
  assignee: Actor;
  description?: string;
  source?: string;
  createdBy: Actor;
}

export type Refusal =
  | 'invalid'
  | 'not_found'
  | 'not_open'
  | 'blocked'
  | 'not_running';

export interface Refused<R extends Refusal> {
  ok: false;
  refusal: R;
}

// A refusal is a result; an error from the database rejects.
export interface TasksService {
  // Opens the tasks database. When it can't, it rejects, and so does every
  // call after it until the server restarts.
  start: () => Promise<void>;
  // Closes the tasks database; does nothing when it never opened.
  stop: () => Promise<void>;
  create: (
    task: NewTask,
  ) => Promise<{ ok: true; task: Task } | Refused<'invalid' | 'not_found'>>;
  // The most urgent ready task assigned to one of the actors, then the
  // oldest, or null when none is ready.
  next: (
    actors: Actor[],
  ) => Promise<{ ok: true; task: Task | null } | Refused<'invalid'>>;
  // The actor takes a ready task, which starts running.
  take: (take: {
    taskId: string;
    actor: Actor;
  }) => Promise<
    { ok: true } | Refused<'invalid' | 'not_found' | 'not_open' | 'blocked'>
  >;
  // The actor ends a running task.
  finish: (finish: {
    taskId: string;
    actor: Actor;
    outcome: Outcome;
    reason?: string;
  }) => Promise<
    { ok: true } | Refused<'invalid' | 'not_found' | 'not_running'>
  >;
}

// The service over the tasks database at an absolute path, or in memory for
// ':memory:'. Nothing opens until start.
export function createTasksService(path: string): TasksService {
  let database: Promise<Tasks> | undefined;

  const opened = () =>
    database ?? Promise.reject(new Error('The tasks service is not started'));

  return {
    start: async () => {
      database ??= openTasks(path);
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
        createdBy: task.createdBy.name,
      });
      return result.ok
        ? { ok: true, task: toTask(result.task) }
        : refused(result.reason);
    },
    next: async (actors) => {
      const result = await (
        await opened()
      ).listReady({ assignees: actors.map((actor) => actor.name), limit: 1 });
      if (!result.ok) {
        return refused(result.reason);
      }
      const [task] = result.tasks;
      return { ok: true, task: task ? toTask(task) : null };
    },
    take: async ({ taskId, actor }) => {
      const result = await (
        await opened()
      ).startTask({ id: taskId, changedBy: actor.name, actor: actor.name });
      return result.ok ? { ok: true } : refused(result.reason);
    },
    finish: async ({ taskId, actor, outcome, reason }) => {
      const result = await (
        await opened()
      ).finishTask({
        id: taskId,
        changedBy: actor.name,
        status: outcome,
        reason,
      });
      return result.ok ? { ok: true } : refused(result.reason);
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
    status: task.status,
  };
}
