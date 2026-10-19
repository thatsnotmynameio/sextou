import { healthResponseSchema } from '@sextou/contract';
import { describe, expect, it } from 'vitest';
import { healthRoutes } from './health.routes';

const startedAt = new Date('2026-10-19T12:00:00.000Z');

describe('GET /health', () => {
  it('answers with the version, in the contract’s shape', async () => {
    const routes = healthRoutes({
      version: '1.2.3',
      startedAt,
      now: () => startedAt,
    });
    const response = await routes.request('/');
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({
      version: '1.2.3',
      uptimeSeconds: 0,
    });
  });

  it('reports the seconds since the start time', async () => {
    const routes = healthRoutes({
      version: '1.2.3',
      startedAt,
      now: () => new Date(startedAt.getTime() + 5000),
    });
    const response = await routes.request('/');
    expect(await response.json()).toMatchObject({ uptimeSeconds: 5 });
  });
});
