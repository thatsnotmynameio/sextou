import { openTasks } from '@sextou/tasks';
import { createService, type TasksService } from './service';

// Opens the task graph at an absolute path, or in memory for ':memory:', and
// returns the service over it. Never rejects: a graph that doesn't open
// doesn't stop the server. It prints why, and each of the service's
// operations rejects with that error until the server restarts.
export async function initTasks(path: string): Promise<TasksService> {
  const opened = openTasks(path);
  await opened.catch((error: unknown) => {
    console.error(
      `Could not open the task graph ${path}: ${(error as Error).message}`,
    );
  });
  return createService(opened);
}
