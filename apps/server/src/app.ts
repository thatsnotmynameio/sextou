import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { appRouter } from './router';
import type { Context } from './trpc';

export interface AppOptions extends Context {
  // The one origin CORS lets read the answers.
  webOrigin: string;
}

// The HTTP app: CORS, then the tRPC router at /trpc.
export function createApp({ webOrigin, ...context }: AppOptions) {
  return new Hono()
    .use('/trpc/*', cors({ origin: webOrigin }))
    .all('/trpc/*', (c) =>
      fetchRequestHandler({
        endpoint: '/trpc',
        req: c.req.raw,
        router: appRouter,
        createContext: () => context,
      }),
    );
}
