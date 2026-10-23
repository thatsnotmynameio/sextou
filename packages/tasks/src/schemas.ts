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

// How long a lease lasts, in milliseconds: from one to the longest delay
// setTimeout takes, which keeps every expiry a safe integer.
const duration = integer.min(1).max(2_147_483_647);

export const claimTaskSchema = z.object({
  claimId: label,
  assignees: z.array(label).min(1),
  actor: label,
  leaseMs: duration,
});

export const renewExecutionSchema = z.object({
  executionId: id,
  leaseMs: duration,
});

export const finishTaskSchema = z.object({
  executionId: id,
  changedBy: label,
  status: z.enum(finalStatuses),
  reason: optional,
  resultPath: optional,
});

export const cancelTaskSchema = z.object({
  id,
  changedBy: label,
  reason: optional,
});

export const assignTaskSchema = z.object({
  id,
  assignee: label,
  changedBy: label,
});

export const expireExecutionsSchema = z.object({
  maxAttempts: integer.min(1),
  changedBy: label,
});

export const listReadySchema = z.object({
  assignees: z.array(label).min(1),
  limit: integer.min(1),
});
