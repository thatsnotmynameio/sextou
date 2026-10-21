import { healthResponseSchema } from '@sextou/contract';
import { openDatabase } from '@sextou/data';
import { describe, expect, it } from 'vitest';
import { healthRoutes } from './health.routes';

const startedAt = new Date('2026-10-19T12:00:00.000Z');
const options = {
  version: '1.2.3',
  startedAt,
  now: () => startedAt,
  pingDatabase: async () => true,
};

describe('GET /health', () => {
  it('answers with the version, in the contract’s shape', async () => {
    const response = await healthRoutes(options).request('/');
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({
      version: '1.2.3',
      uptimeSeconds: 0,
      database: 'up',
    });
  });

  it('reports the seconds since the start time', async () => {
    const routes = healthRoutes({
      ...options,
      now: () => new Date(startedAt.getTime() + 5000),
    });
    const response = await routes.request('/');
    expect(await response.json()).toMatchObject({ uptimeSeconds: 5 });
  });

  it('answers 503 when the database does not answer', async () => {
    const routes = healthRoutes({
      ...options,
      pingDatabase: async () => false,
    });
    const response = await routes.request('/');
    expect(response.status).toBe(503);
    expect(healthResponseSchema.parse(await response.json())).toEqual({
      version: '1.2.3',
      uptimeSeconds: 0,
      database: 'down',
    });
  });

  it('answers 503 once a real database is closed', async () => {
    const database = await openDatabase(':memory:');
    const routes = healthRoutes({ ...options, pingDatabase: database.ping });
    expect((await routes.request('/')).status).toBe(200);
    await database.close();
    expect((await routes.request('/')).status).toBe(503);
  });

  it('asks the database again on each request', async () => {
    let answers = false;
    const routes = healthRoutes({
      ...options,
      pingDatabase: async () => answers,
    });
    expect((await routes.request('/')).status).toBe(503);
    answers = true;
    const response = await routes.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ database: 'up' });
  });
});
