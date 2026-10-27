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
// now, so the runner drops what it has. A call whose answer didn't arrive
// can be sent again as it was: a claim with its claimId, a completion as it
// was, which succeeds once more. A call the tasks database didn't serve in
// time fails with TIMEOUT, having written nothing.
export const runnersRouter = router({
  // The task's uses, split, and its context: a task that names no uses is
  // claimed like any other, with a null uses, and its runner fails it.
  claim: procedure
    .input(claimInputSchema)
    .output(claimOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const claimed = accepted(
        await ctx.tasks.claim({
          claimId: input.claimId,
          runner: { name: input.runner },
          assignees: input.assignees.map((name) => ({ name })),
        }),
      );
      return claimed.task === null
        ? { task: null }
        : {
            task: {
              id: claimed.task.id,
              uses: claimed.uses,
              context: claimed.task.context,
            },
            execution: claimed.execution,
          };
    }),

  heartbeat: procedure
    .input(heartbeatInputSchema)
    .output(heartbeatOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const { cancel, leaseMs } = accepted(
        await ctx.tasks.renew(input.executionId),
      );
      return { cancel, leaseMs };
    }),

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
