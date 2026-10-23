import { TRPCError } from '@trpc/server';
import { expect, test } from 'vitest';
import { createLogger } from '../../../../src/logger';
import { healthRouter } from '../../../../src/modules/health/health.router';
import { createCallerFactory, type Context } from '../../../../src/trpc';
import { fakeTasks } from '../../../tasks';

const createCaller = createCallerFactory(healthRouter);

function caller(context: Partial<Context> = {}) {
  return createCaller({
    version: '1.2.3',
    database: { ping: async () => true },
    dev: false,
    logger: createLogger({ level: 'silent', pretty: false }),
    tasks: fakeTasks(),
    ...context,
  });
}

test('health.check reports the version and the database up when it answers', async () => {
  expect(await caller().check()).toEqual({
    version: '1.2.3',
    database: 'up',
  });
});

test('health.check reports the database down when it does not answer', async () => {
  expect(
    await caller({ database: { ping: async () => false } }).check(),
  ).toEqual({ version: '1.2.3', database: 'down' });
});

test('health.check fails with INTERNAL_SERVER_ERROR when its answer breaks the output schema', async () => {
  const result = caller({ version: '' }).check();

  await expect(result).rejects.toBeInstanceOf(TRPCError);
  await expect(result).rejects.toMatchObject({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Output validation failed',
  });
});
