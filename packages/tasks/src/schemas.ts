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

// A JSON object the caller may leave out, stored as given: null when it is
// absent. One nested deeper than Turso stores is refused before zod walks it.
const context = z
  .unknown()
  .refine((value) => !deeperThan(value, maxContextDepth))
  .pipe(jsonObject)
  .optional()
  .transform((value) => value ?? null);

// Where the Taskfile a task runs lives: a public GitHub repository, at a
// commit, so every attempt runs the same code, and the path to the Taskfile
// inside it.
const usesPartsSchema = z.object({
  // owner/name, neither of them . or .., which the URL a runner downloads
  // from would resolve to another path.
  repo: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .refine((repo) =>
      repo.split('/').every((part) => part !== '.' && part !== '..'),
    ),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  // A file inside the repository, by its relative path: segments separated
  // by single slashes, none of them empty, . or .., so no leading or trailing
  // slash either.
  taskfile: z
    .string()
    .refine((path) =>
      path
        .split('/')
        .every((part) => part !== '' && part !== '.' && part !== '..'),
    ),
});

export type Uses = z.infer<typeof usesPartsSchema>;

/**
 * Splits a uses into its parts: at its last @, since a SHA holds none, then
 * owner/name and the path. It splits with string search, in time linear in
 * the text: a regex that splits at the last @ backtracks over every @ before
 * it.
 * @param uses owner/name/path/to/Taskfile.yml@sha
 * @returns the repository, the commit and the Taskfile's path, or null when a
 * part breaks its rules
 */
export function splitUses(uses: string): Uses | null {
  const at = uses.lastIndexOf('@');
  // Stryker disable next-line ConditionalExpression,BlockStatement,UnaryOperator: with no @, or one before the second /, owner/name or the path is incomplete and refused anyway
  if (at === -1) {
    return null;
  }
  const [owner, name, ...path] = uses.slice(0, at).split('/');
  const parsed = usesPartsSchema.safeParse({
    repo: [owner, name].join('/'),
    sha: uses.slice(at + 1),
    taskfile: path.join('/'),
  });
  return parsed.success ? parsed.data : null;
}

// A uses the caller may leave out, stored as given: null when it is absent.
const uses = z
  .string()
  .refine((value) => splitUses(value) !== null)
  .optional()
  .transform((value) => value ?? null);

// 0 is the most urgent, 4 the least.
const priority = integer.min(0).max(4);

export const createTaskSchema = z.object({
  title: label,
  kind: label,
  priority,
  parentId: id.optional(),
  assignee: label,
  description: optional,
  sourcePath: optional,
  context,
  uses,
  createdBy: label,
});

// The key that names a task within the file a run leaves.
export const fileTaskKeySchema = label;

// A task in the file a run leaves: what createTask takes but its parent and
// its creator, which the finish gives, under the names tasks.create takes
// (source for sourcePath), with a key that names it within the file and the
// keys of the file's tasks it waits for. A field the format doesn't define is
// refused, so a typo such as blocked_by can't make a task ready out of order.
const fileTaskSchema = z.strictObject({
  key: fileTaskKeySchema,
  title: label,
  kind: label,
  priority,
  assignee: label,
  description: optional,
  source: optional,
  context,
  uses,
  blockedBy: z.array(label).optional(),
});

export type FileTask = z.infer<typeof fileTaskSchema>;

// The file of tasks a run leaves, as JSON: an object, so a later field can
// join the format without breaking the files written before it.
export const tasksFileSchema = z.strictObject({
  tasks: z.array(fileTaskSchema),
});

export type TasksFile = z.infer<typeof tasksFileSchema>;

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

const finish = z.object({
  executionId: id,
  changedBy: label,
  status: z.enum(finalStatuses),
  reason: optional,
  resultPath: optional,
});

// A limit on what a file of tasks creates: the tasks in one file, or how deep
// they sit under their roots.
const limit = integer.min(1);

// A finish carries the text of the file its run left, as sent, and the
// limits that judge it; without a text, the limits may be left out.
export const finishTaskSchema = z.union([
  finish.extend({ tasks: z.string(), maxTasks: limit, maxDepth: limit }),
  finish.extend({
    tasks: z.undefined().optional(),
    maxTasks: limit.optional(),
    maxDepth: limit.optional(),
  }),
]);

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
