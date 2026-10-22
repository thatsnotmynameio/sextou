import { initTRPC } from '@trpc/server';

// One level of a logger: a message, or fields and then a message.
interface LogMethod {
  (msg: string): void;
  (fields: object, msg?: string): void;
}

// The logger a procedure writes through, by the methods it calls. A Pino
// logger is one; Pino's own type needs Node, which this file can't.
export interface Logger {
  fatal: LogMethod;
  error: LogMethod;
  warn: LogMethod;
  info: LogMethod;
  debug: LogMethod;
  trace: LogMethod;
}

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
  logger: Logger;
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
