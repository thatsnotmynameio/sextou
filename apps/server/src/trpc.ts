import { initTRPC } from '@trpc/server';

// What every procedure gets. main.ts builds it from the config; tests pass
// their own. The web app's typecheck follows the router into this file, so
// nothing here may need Node: Node's code stays in main.ts and config.ts.
export interface Context {
  version: string;
  database: {
    // Whether the database answers a query. Never rejects.
    ping: () => Promise<boolean>;
  };
  // Whether error responses carry the stack.
  dev: boolean;
}

// isDev is false because tRPC's default reads NODE_ENV, which the bundle
// doesn't set; the stack comes from the context instead.
const t = initTRPC.context<Context>().create({
  isDev: false,
  errorFormatter: ({ shape, error, ctx }) =>
    ctx?.dev
      ? { ...shape, data: { ...shape.data, stack: error.stack } }
      : shape,
});

export const router = t.router;
export const procedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
