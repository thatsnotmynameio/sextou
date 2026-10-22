import { expect, test } from 'vitest';
import { createLogger } from '../../../../src/logger';
import { runnerRouter } from '../../../../src/modules/runner/runner.router';
import { createCallerFactory, type Context } from '../../../../src/trpc';

const createCaller = createCallerFactory(runnerRouter);

function caller(context: Partial<Context> = {}) {
  return createCaller({
    version: '1.2.3',
    database: { ping: async () => true },
    dev: false,
    logger: createLogger({ level: 'silent', pretty: false }),
    ...context,
  });
}

test('runner.next answers that there is no task', async () => {
  expect(await caller().next()).toEqual({ task: null });
});

test('runner.next answers without asking the database', async () => {
  const ping = async () => {
    throw new Error('runner.next asked the database');
  };

  expect(await caller({ database: { ping } }).next()).toEqual({ task: null });
});
