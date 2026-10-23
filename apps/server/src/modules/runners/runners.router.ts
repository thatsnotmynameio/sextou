import { z } from 'zod';
import { procedure, refusalError, router } from '../../trpc';
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
  claim: procedure
    .input(claimInputSchema)
    .output(claimOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.tasks.claim({
        runner: { name: input.runner },
        assignees: input.assignees.map((name) => ({ name })),
      });
      if (!result.ok) {
        throw refusalError(result.refusal);
      }
      // Stryker disable next-line ConditionalExpression: the output schema strips an undefined execution, so both branches answer { task: null } for no task.
      return result.task === null
        ? { task: null }
        : { task: result.task, execution: result.execution };
    }),

  heartbeat: procedure
    .input(heartbeatInputSchema)
    .output(heartbeatOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.tasks.renew(input.executionId);
      if (!result.ok) {
        throw refusalError(result.refusal);
      }
      return { cancel: result.cancel };
    }),

  complete: procedure
    .input(completeInputSchema)
    .output(z.null())
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.tasks.finish({
        executionId: input.executionId,
        runner: { name: input.runner },
        outcome: input.outcome,
        reason: input.reason,
      });
      if (!result.ok) {
        throw refusalError(result.refusal);
      }
      return null;
    }),
});
