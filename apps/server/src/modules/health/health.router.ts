import { procedure, router } from '../../trpc';
import { healthSchema } from './health.schema';

export const healthRouter = router({
  // The server's version, and whether its database answers.
  check: procedure.output(healthSchema).query(async ({ ctx }) => ({
    version: ctx.version,
    database: (await ctx.database.ping()) ? ('up' as const) : ('down' as const),
  })),
});
