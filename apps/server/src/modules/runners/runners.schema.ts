import { z } from 'zod';
import { Outcome } from '../../tasks';
import { idSchema, nameSchema, taskSchema } from '../tasks/index';

export const claimInputSchema = z.object({
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
      // Renew before it runs out: a third of it is a safe interval.
      leaseMs: z.number().int().min(1),
    }),
  }),
  z.object({ task: z.null() }),
]);

export const heartbeatInputSchema = z.object({ executionId: idSchema });

export const heartbeatOutputSchema = z.object({
  // Someone asked to cancel the task: stop it and complete it as cancelled.
  cancel: z.boolean(),
});

export const completeInputSchema = z.object({
  runner: nameSchema,
  executionId: idSchema,
  outcome: z.enum(Outcome),
  reason: z.string().optional(),
});
