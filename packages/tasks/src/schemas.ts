import { z } from 'zod';
import { finalStatuses } from './status';

// The inputs of the graph's operations. An input its schema rejects is refused
// as invalid, writing nothing.

// Any string: whether it names a task is the graph's to answer, as not found.
const id = z.string();

// A label with its spaces trimmed, never blank.
const label = z.string().trim().min(1);

// Text the caller may leave out, with its spaces trimmed: null when it is
// absent or blank.
const optional = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || null);

// A whole number, safe or not: int() would refuse one past 2^53.
const integer = z.number().refine(Number.isInteger);

export const createTaskSchema = z.object({
  title: label,
  kind: label,
  // 0 is the most urgent, 4 the least.
  priority: integer.min(0).max(4),
  parentId: id.optional(),
  assignee: label,
  description: optional,
  sourcePath: optional,
  createdBy: label,
});

export const linkSchema = z.object({ taskId: id, blockerId: id });

export const unlinkSchema = linkSchema;

export const startTaskSchema = z.object({
  id,
  changedBy: label,
  actor: label,
  logPath: optional,
});

export const finishTaskSchema = z.object({
  id,
  changedBy: label,
  status: z.enum(finalStatuses),
  reason: optional,
  resultPath: optional,
});

export const listReadySchema = z.object({
  assignees: z.array(label).min(1),
  limit: integer.min(1),
});
