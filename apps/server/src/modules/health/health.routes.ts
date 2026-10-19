import type { HealthResponse } from '@sextou/contract';
import { getHealth } from '@sextou/core';
import { Hono } from 'hono';

export interface HealthRoutesOptions {
  version: string;
  startedAt: Date;
  now: () => Date;
}

// GET /: the server's version and uptime, computed by the core.
export function healthRoutes({ version, startedAt, now }: HealthRoutesOptions) {
  return new Hono().get('/', (c) =>
    c.json<HealthResponse>(getHealth({ version, startedAt, now: now() })),
  );
}
