import { z } from 'zod';
import { Outcome } from '../../tasks';
import { idSchema, nameSchema } from '../tasks/index';

export const claimInputSchema = z.object({
  // The runner's own name for this claim, new for each: sent again with the
  // same one when the answer didn't arrive, it gets the same attempt back.
  claimId: idSchema,
  // Who asks: the runner, by name.
  runner: nameSchema,
  // The assignees whose tasks the runner takes.
  assignees: z.array(nameSchema).min(1),
});

// Where the Taskfile a task runs lives: a public GitHub repository, at a
// commit, so what runs is fixed when the task is claimed, and the path to the
// Taskfile inside it. The runner downloads the repository at that commit and
// runs the Taskfile there, beside the files it uses.
export const sourceSchema = z.object({
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  // Relative, and inside the repository: no leading slash, no .. segment.
  taskfile: z
    .string()
    .min(1)
    .refine(
      (path) => !path.startsWith('/') && !path.split('/').includes('..'),
      'a path inside the repository',
    ),
});

// The task the runner now holds and the attempt it runs, or no task. The
// task carries what the runner runs, not its planning fields: its id, and
// where the Taskfile whose default task the runner runs lives.
export const claimOutputSchema = z.union([
  z.object({
    task: z.object({ id: idSchema, source: sourceSchema }),
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
