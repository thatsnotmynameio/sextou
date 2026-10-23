import { z } from 'zod';
import { accepted, procedure, router } from '../../trpc';
import {
  claimInputSchema,
  claimOutputSchema,
  completeInputSchema,
  heartbeatInputSchema,
  heartbeatOutputSchema,
} from './runners.schema';

// What a runner calls: claim a task, heartbeat while it runs, complete it. A
// heartbeat or a completion for an attempt that lost its lease fails with
// CONFLICT and the message lease_lost: another attempt may hold the task
// now, so the runner drops what it has.
export const runnersRouter = router({
  // The output schema keeps the task and its execution, and drops ok.
  claim: procedure
    .input(claimInputSchema)
    .output(claimOutputSchema)
    .mutation(async ({ ctx, input }) =>
      accepted(
        await ctx.tasks.claim({
          runner: { name: input.runner },
          assignees: input.assignees.map((name) => ({ name })),
        }),
      ),
    ),

  heartbeat: procedure
    .input(heartbeatInputSchema)
    .output(heartbeatOutputSchema)
    .mutation(async ({ ctx, input }) => ({
      cancel: accepted(await ctx.tasks.renew(input.executionId)).cancel,
    })),

  complete: procedure
    .input(completeInputSchema)
    .output(z.null())
    .mutation(async ({ ctx, input }) => {
      accepted(
        await ctx.tasks.finish({
          executionId: input.executionId,
          runner: { name: input.runner },
          outcome: input.outcome,
          reason: input.reason,
        }),
      );
      return null;
    }),
});
