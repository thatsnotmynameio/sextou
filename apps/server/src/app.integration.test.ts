import { healthResponseSchema } from '@sextou/contract';
import { expect, test } from 'vitest';
import { createApp } from './app';

const startedAt = new Date('2026-10-19T12:00:00.000Z');
const app = createApp({
  version: '1.2.3',
  startedAt,
  now: () => startedAt,
  pingDatabase: async () => true,
});

test('createApp serves /health in the contract’s shape', async () => {
  const response = await app.request('/health');
  expect(response.status).toBe(200);
  expect(healthResponseSchema.parse(await response.json())).toEqual({
    version: '1.2.3',
    uptimeSeconds: 0,
    database: 'up',
  });
});

test('createApp passes its database probe to /health', async () => {
  const down = createApp({
    version: '1.2.3',
    startedAt,
    now: () => startedAt,
    pingDatabase: async () => false,
  });
  const response = await down.request('/health');
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ database: 'down' });
});

test('createApp answers 404 for a path no module serves', async () => {
  expect((await app.request('/missing')).status).toBe(404);
});
