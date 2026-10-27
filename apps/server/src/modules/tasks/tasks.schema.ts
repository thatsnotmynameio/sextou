import { z } from 'zod';
import { Status } from '../../tasks';

// A name with its spaces trimmed, never blank: an actor's, or an assignee's.
export const nameSchema = z.string().trim().min(1);

// An id as given: whether it names a task is the tasks' to answer.
export const idSchema = z.string().min(1);

const prioritySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

// A task's context: a JSON object the server stores with the task and hands
// to the runner that claims it. Its values are unknown here, since zod's own
// JSON check recurses and a deep value would overflow the stack: the tasks
// check its depth without recursion before they check it is JSON, and refuse
// it as invalid.
export const contextSchema = z.record(z.string(), z.unknown());

// A task as every procedure answers it.
export const taskSchema = z.object({
  id: idSchema,
  title: z.string().min(1),
  kind: z.string().min(1),
  priority: prioritySchema,
  parentId: idSchema.nullable(),
  assignee: z.object({ name: nameSchema }),
  description: z.string().nullable(),
  source: z.string().nullable(),
  context: contextSchema.nullable(),
  uses: z.string().nullable(),
  status: z.enum(Status),
});

export const createInputSchema = z.object({
  title: z.string(),
  kind: z.string(),
  priority: prioritySchema,
  parentId: idSchema.optional(),
  assignee: nameSchema,
  description: z.string().optional(),
  source: z.string().optional(),
  context: contextSchema.optional(),
  // owner/name/path/to/Taskfile.yml@sha, the Taskfile a runner runs for the
  // task: the tasks check it, and refuse one that breaks their rules as
  // invalid.
  uses: z.string().optional(),
  createdBy: nameSchema,
});

export const cancelInputSchema = z.object({
  taskId: idSchema,
  actor: nameSchema,
  reason: z.string().optional(),
});

export const cancelOutputSchema = z.object({
  status: z.enum([Status.cancelled, Status.running]),
});

export const assignInputSchema = z.object({
  taskId: idSchema,
  assignee: nameSchema,
  actor: nameSchema,
});
