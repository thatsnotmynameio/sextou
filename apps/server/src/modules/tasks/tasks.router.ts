import { z } from 'zod';
import { accepted, procedure, router } from '../../trpc';
import {
  assignInputSchema,
  cancelInputSchema,
  cancelOutputSchema,
  createInputSchema,
  linkInputSchema,
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

  // Makes an open task wait for its blocker: no runner claims it until the
  // blocker succeeded or was skipped. A task is ready once created, so to
  // create one that waits, create it under an assignee no runner serves,
  // link it, then assign it to its real assignee. The same link sent again
  // succeeds.
  link: procedure
    .input(linkInputSchema)
    .output(z.null())
    .mutation(async ({ ctx, input }) => {
      accepted(await ctx.tasks.link(input));
      return null;
    }),

  // Stops an open task waiting for its blocker, as for one that failed or was
  // cancelled, which holds the task until the link is removed. A pair not
  // linked succeeds.
  unlink: procedure
    .input(linkInputSchema)
    .output(z.null())
    .mutation(async ({ ctx, input }) => {
      accepted(await ctx.tasks.unlink(input));
      return null;
    }),
});
