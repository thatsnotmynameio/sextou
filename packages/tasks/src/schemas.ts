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

// A JSON object.
const jsonObject = z.record(z.string(), z.json());

export type Context = z.infer<typeof jsonObject>;

// The deepest nesting of objects and arrays Turso's json_valid accepts.
const maxContextDepth = 500;

// Whether the value nests objects and arrays deeper than the limit. It walks
// without recursion and stops past the limit, so neither a deep value nor a
// cycle overflows the stack, as zod's own recursive check would.
function deeperThan(value: unknown, limit: number) {
  const pending: [unknown, number][] = [[value, 0]];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [item, depth] = next;
    if (typeof item === 'object' && item !== null) {
      if (depth === limit) {
        return true;
      }
      for (const child of Object.values(item)) {
        pending.push([child, depth + 1]);
      }
    }
  }
  return false;
}

// A JSON object the caller may leave out, stored as given and never read:
// null when it is absent. One nested deeper than Turso stores is refused
// before zod walks it.
const context = z
  .unknown()
  .refine((value) => !deeperThan(value, maxContextDepth))
  .pipe(jsonObject)
  .optional()
  .transform((value) => value ?? null);

export const createTaskSchema = z.object({
  title: label,
  kind: label,
  // 0 is the most urgent, 4 the least.
  priority: integer.min(0).max(4),
  parentId: id.optional(),
  assignee: label,
  description: optional,
  sourcePath: optional,
  context,
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
