// The tasks module runs @sextou/tasks for real, two sextou packages
// together, so its tests are integration tests and no unit test answers for
// it, even on ':memory:'.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTasks } from '@sextou/tasks';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { initTasks } from './index';
import type { TasksService } from './service';

// The real library, watched so a test can reach the error openTasks
// rejected with.
vi.mock(import('@sextou/tasks'), async (importOriginal) => {
  const tasks = await importOriginal();
  return { ...tasks, openTasks: vi.fn(tasks.openTasks) };
});

let dir: string;
const opened: TasksService[] = [];

async function init(path: string) {
  const service = await initTasks(path);
  opened.push(service);
  return service;
}

// The error the last call to openTasks rejected with.
function rejection(): Promise<unknown> {
  return vi
    .mocked(openTasks)
    .mock.results.at(-1)
    ?.value.then(
      () => undefined,
      (error: unknown) => error,
    );
}

const newTask = {
  title: 'Write the tests',
  kind: 'task',
  priority: 2,
  assignee: 'dev',
  createdBy: 'planner',
};

// A path holding a file that is not a database, which openTasks rejects.
function notADatabase() {
  const path = join(dir, 'tasks.db');
  writeFileSync(path, 'not a database, just some text that is long enough');
  return path;
}

beforeEach(() => {
  vi.clearAllMocks();
  dir = mkdtempSync(join(tmpdir(), 'sextou-tasks-init-'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await Promise.all(opened.splice(0).map((service) => service.close()));
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

test('initTasks on :memory: returns a service that creates tasks', async () => {
  const service = await init(':memory:');

  expect(await service.createTask(newTask)).toMatchObject({
    ok: true,
    task: { title: 'Write the tests', status: 'open' },
  });
});

test('initTasks on a file creates the file and its missing folder', async () => {
  const path = join(dir, 'data', 'tasks.db');

  await init(path);

  expect(existsSync(path)).toBe(true);
});

test('initTasks resolves when the graph does not open, and prints one line naming the path and the error', async () => {
  const path = notADatabase();

  await init(path);

  const error = (await rejection()) as Error;
  expect(console.error).toHaveBeenCalledOnce();
  expect(console.error).toHaveBeenCalledWith(
    `Could not open the task graph ${path}: ${error.message}`,
  );
});

test('after a failed init, each operation rejects with the error openTasks rejected with', async () => {
  const service = await init(notADatabase());
  const error = await rejection();

  await expect(service.createTask(newTask)).rejects.toBe(error);
  await expect(service.nextTask(['dev'])).rejects.toBe(error);
  await expect(
    service.startTask({ id: 'tsk_1', changedBy: 'dev', actor: 'dev' }),
  ).rejects.toBe(error);
  await expect(
    service.finishTask({ id: 'tsk_1', changedBy: 'dev', status: 'failed' }),
  ).rejects.toBe(error);
});

test('after a failed init, close resolves and the operations still reject', async () => {
  const service = await init(notADatabase());
  const error = await rejection();

  await expect(service.close()).resolves.toBeUndefined();

  await expect(service.createTask(newTask)).rejects.toBe(error);
});
