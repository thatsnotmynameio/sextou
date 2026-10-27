import { initTRPC, TRPCError, type TRPC_ERROR_CODE_KEY } from '@trpc/server';
import type { Refusal, Refused, Tasks } from './tasks';

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
  // A logger that adds the fields to each line it writes.
  child: (fields: object) => Logger;
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
  // The task graph and the runners' leases: main.ts passes the tasks
  // service.
  tasks: Tasks;
}

// The HTTP code of each refusal from the tasks.
const refusalCodes = {
  invalid: 'BAD_REQUEST',
  not_found: 'NOT_FOUND',
  // Wrong whatever the tasks hold, as an invalid input is.
  same_task: 'BAD_REQUEST',
  not_open: 'CONFLICT',
  // Depends on the links already there, as not_open on the task's state.
  cycle: 'CONFLICT',
  lease_lost: 'CONFLICT',
  already_finished: 'CONFLICT',
  timeout: 'TIMEOUT',
} as const satisfies Record<Refusal, TRPC_ERROR_CODE_KEY>;

// A call's result when the tasks accepted it. A refusal throws its HTTP
// error instead, with the refusal as the message, so a caller tells two
// conflicts apart.
export function accepted<T extends { ok: true }>(
  result: T | Refused<Refusal>,
): T {
  if (!result.ok) {
    throw new TRPCError({
      code: refusalCodes[result.refusal],
      message: result.refusal,
    });
  }
  return result;
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
