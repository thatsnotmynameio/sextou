import { Hono } from 'hono';
import { healthRoutes } from './modules/health/health.routes';

export interface AppOptions {
  version: string;
  startedAt: Date;
  // The current time; tests pass a fixed one.
  now: () => Date;
  // Whether the database answers a query; never throws.
  pingDatabase: () => boolean;
}

// The HTTP app, with each module's routes under its own path.
export function createApp(options: AppOptions) {
  return new Hono().route('/health', healthRoutes(options));
}
