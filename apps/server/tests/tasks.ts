import type { Tasks } from '../src/tasks';

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
