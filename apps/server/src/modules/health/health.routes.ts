import type { HealthResponse } from '@sextou/contract';
import { getHealth } from '@sextou/core';
import { Hono } from 'hono';

export interface HealthRoutesOptions {
  version: string;
  startedAt: Date;
  now: () => Date;
  // Whether the database answers a query; never rejects.
  pingDatabase: () => Promise<boolean>;
}

// GET /: the server's version, uptime and database status, computed by the
// core. 503 when the database does not answer, with the same body.
export function healthRoutes({
  version,
  startedAt,
  now,
  pingDatabase,
}: HealthRoutesOptions) {
  return new Hono().get('/', async (c) => {
    const health = getHealth({
      version,
      startedAt,
      now: now(),
      databaseAnswers: await pingDatabase(),
    });
    return c.json<HealthResponse>(health, health.database === 'up' ? 200 : 503);
  });
}
