import { z } from 'zod';
import { accepted, procedure, router } from '../../trpc';
import {
  assignInputSchema,
  cancelInputSchema,
  cancelOutputSchema,
  createInputSchema,
  taskSchema,
} from './tasks.schema';

export const tasksRouter = router({
  // Creates an open task, assigned to who may take it.
  create: procedure
    .input(createInputSchema)
    .output(taskSchema)
    .mutation(
      async ({ ctx, input }) =>
        accepted(
          await ctx.tasks.create({
            ...input,
            assignee: { name: input.assignee },
            createdBy: { name: input.createdBy },
          }),
        ).task,
    ),

  // Cancels an open task at once; for a running one, the runner learns of
  // it on its next heartbeat and ends the task.
  cancel: procedure
    .input(cancelInputSchema)
    .output(cancelOutputSchema)
    .mutation(async ({ ctx, input }) => ({
      status: accepted(
        await ctx.tasks.cancel({
          taskId: input.taskId,
          actor: { name: input.actor },
          reason: input.reason,
        }),
      ).status,
    })),

  // Hands an open task to another assignee.
  assign: procedure
    .input(assignInputSchema)
    .output(z.null())
    .mutation(async ({ ctx, input }) => {
      accepted(
        await ctx.tasks.assign({
          taskId: input.taskId,
          assignee: { name: input.assignee },
          actor: { name: input.actor },
        }),
      );
      return null;
    }),
});
