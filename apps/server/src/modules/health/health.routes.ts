import type { HealthResponse } from '@sextou/contract';
import { getHealth } from '@sextou/core';
import { Hono } from 'hono';

export interface HealthRoutesOptions {
  version: string;
  startedAt: Date;
  now: () => Date;
  // Whether the database answers a query; never throws.
  pingDatabase: () => boolean;
  // Whether beads answers; never rejects.
  pingBeads: () => Promise<boolean>;
}

// GET /: the server's version, uptime, and database and beads status,
// computed by the core. 503 when either does not answer, with the same body.
export function healthRoutes({
  version,
  startedAt,
  now,
  pingDatabase,
  pingBeads,
}: HealthRoutesOptions) {
  return new Hono().get('/', async (c) => {
    const health = getHealth({
      version,
      startedAt,
      now: now(),
      databaseAnswers: pingDatabase(),
      beadsAnswers: await pingBeads(),
    });
    const up = health.database === 'up' && health.beads === 'up';
    return c.json<HealthResponse>(health, up ? 200 : 503);
  });
}
