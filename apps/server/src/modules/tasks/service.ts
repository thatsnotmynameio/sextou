import type { Reason, Refused, Task, Tasks } from '@sextou/tasks';

// The server's way into the task graph. Each operation takes and returns the
// library's own shapes: a refusal is a result with a reason, an error
// rejects, and every name is any string the caller passes, never checked.
export interface TasksService {
  createTask: Tasks['createTask'];
  // The most urgent ready task whose assignee is one of assignees, then the
  // oldest, or null when none is ready. Refuses an empty list.
  nextTask: (
    assignees: string[],
  ) => Promise<
    { ok: true; task: Task | null } | Refused<typeof Reason.invalid>
  >;
  // Records actor as the task's executor; the assignee stays as it was.
  startTask: Tasks['startTask'];
  finishTask: Tasks['finishTask'];
  // Closes the task graph; does nothing when it never opened.
  close: () => Promise<void>;
}

// The service over the task graph's opening, settled once: when it rejected,
// every operation rejects with its error.
export function createService(opened: Promise<Tasks>): TasksService {
  return {
    createTask: async (task) => (await opened).createTask(task),
    nextTask: async (assignees) => {
      const ready = await (await opened).listReady({ assignees, limit: 1 });
      return ready.ok ? { ok: true, task: ready.tasks[0] ?? null } : ready;
    },
    startTask: async (start) => (await opened).startTask(start),
    finishTask: async (finish) => (await opened).finishTask(finish),
    close: () =>
      opened.then(
        (tasks) => tasks.close(),
        () => undefined,
      ),
  };
}
