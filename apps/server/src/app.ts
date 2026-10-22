import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestId, type RequestIdVariables } from 'hono/request-id';
import { appRouter } from './router';
import type { Context } from './trpc';

export interface AppOptions extends Context {
  // The one origin CORS lets read the answers.
  webOrigin: string;
}

// The HTTP app: CORS, then the tRPC router at /trpc. Each request gets an id,
// the X-Request-Id it carries or a new one, and its procedures a logger
// bound to it.
export function createApp({ webOrigin, logger, ...context }: AppOptions) {
  return new Hono<{ Variables: RequestIdVariables }>()
    .use('/trpc/*', requestId())
    .use('/trpc/*', cors({ origin: webOrigin }))
    .all('/trpc/*', (c) =>
      fetchRequestHandler({
        endpoint: '/trpc',
        req: c.req.raw,
        router: appRouter,
        createContext: () => ({
          ...context,
          logger: logger.child({ requestId: c.var.requestId }),
        }),
      }),
    );
}
