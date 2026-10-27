import { createLogger } from '@sextou/logger';
import { Status, type Task, type Tasks } from '../src/tasks';
import type { Context } from '../src/trpc';

// A Tasks port for a test's context: each call the test doesn't stub
// rejects, so a procedure that reaches one by mistake fails the test.
export function fakeTasks(stubs: Partial<Tasks> = {}): Tasks {
  const unexpected = (name: string) => () =>
    Promise.reject(new Error(`tasks.${name} was not expected`));
  return {
    create: unexpected('create'),
    claim: unexpected('claim'),
    renew: unexpected('renew'),
    finish: unexpected('finish'),
    cancel: unexpected('cancel'),
    assign: unexpected('assign'),
    ...stubs,
  };
}

// The context a procedure gets in a unit test: a database that answers, a
// silent logger and the fake tasks, with the fields a test overrides.
export function testContext(fields: Partial<Context> = {}): Context {
  return {
    version: '1.2.3',
    database: { ping: async () => true },
    dev: false,
    logger: createLogger({ level: 'silent', pretty: false }),
    tasks: fakeTasks(),
    ...fields,
  };
}

/**
 * An open task, with no uses or context.
 * @param fields the fields a test overrides
 */
export function aTask(fields: Partial<Task> = {}): Task {
  return {
    id: 'tsk_1',
    title: 'Write the tests',
    kind: 'task',
    priority: 2,
    parentId: null,
    assignee: { name: 'dev' },
    description: null,
    source: null,
    context: null,
    uses: null,
    status: Status.open,
    ...fields,
  };
}
