import { z } from 'zod';
import { Outcome } from '../../tasks';
import { idSchema, nameSchema, taskSchema } from '../tasks/index';

export const claimInputSchema = z.object({
  // The runner's own name for this claim, new for each: sent again with the
  // same one when the answer didn't arrive, it gets the same attempt back.
  claimId: idSchema,
  // Who asks: the runner, by name.
  runner: nameSchema,
  // The assignees whose tasks the runner takes.
  assignees: z.array(nameSchema).min(1),
});

// The task the runner now holds and the attempt it runs, or no task.
export const claimOutputSchema = z.union([
  z.object({
    task: taskSchema,
    execution: z.object({
      id: idSchema,
      attempt: z.number().int().min(1),
      // Renew before it runs out: a third of it is the interval the server
      // waits for when it ran late.
      leaseMs: z.number().int().min(1),
    }),
  }),
  z.object({ task: z.null() }),
]);

export const heartbeatInputSchema = z.object({ executionId: idSchema });

export const heartbeatOutputSchema = z.object({
  // Someone asked to cancel the task: stop it and complete it as cancelled.
  cancel: z.boolean(),
  // How long the renewed lease lasts: pace the next heartbeat by it, since
  // the server's lease may have changed since the claim.
  leaseMs: z.number().int().min(1),
});

export const completeInputSchema = z.object({
  runner: nameSchema,
  executionId: idSchema,
  outcome: z.enum(Outcome),
  reason: z.string().optional(),
});
