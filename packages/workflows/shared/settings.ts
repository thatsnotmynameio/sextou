import { isAbsolute, resolve, sep } from 'node:path';

// What every script beside a Taskfile reads the same way, with no disk.

export type ReadContext =
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; reason: string };

// The task's context, as JSON, beside the run's workspace, an absolute path:
// the context's fields, or why it refuses them.
export function readContext(context: string, workspace: string): ReadContext {
  if (!isAbsolute(workspace)) {
    return { ok: false, reason: 'workspace is an absolute path' };
  }
  let input: unknown;
  // Stryker disable BlockStatement: an input left undefined refuses the same, below
  try {
    input = JSON.parse(context);
  } catch {
    return { ok: false, reason: 'context is a JSON object' };
  }
  // Stryker restore BlockStatement
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'context is a JSON object' };
  }
  return { ok: true, fields: input as Record<string, unknown> };
}

// A path of the task's context resolved against the run's workspace, an
// absolute path: undefined when it isn't a string, holds a NUL, which
// reaches no file, or leads out of the workspace.
export function insideWorkspace(
  workspace: string,
  path: unknown,
): string | undefined {
  const root = resolve(workspace);
  const destination =
    typeof path === 'string' && !path.includes('\0')
      ? resolve(root, path)
      : undefined;
  return destination === root || destination?.startsWith(root + sep)
    ? destination
    : undefined;
}

// A timeout from the runner's environment: `fallback` when it is unset, a
// whole number of milliseconds from 1 to 2147483647, the most a timer takes,
// as the runner's own settings, and undefined when it is set to anything
// else.
export function readTimeout(
  value: string | undefined,
  fallback: number,
): number | undefined {
  if (value === undefined) {
    return fallback;
  }
  const ms = Number(value);
  return /^[1-9]\d*$/.test(value) && ms <= 2147483647 ? ms : undefined;
}

// How long a program a script stops may take to exit before it is killed:
// 10 seconds, as the runner's SEXTOU_RUNNER_KILL_GRACE_MS, unless the
// workflow's own variable sets another.
export const defaultKillGraceMs = 10_000;

// The program a variable of the runner's environment names: `fallback`, a
// command on the PATH, when it is unset or empty, else a command on the PATH
// or an absolute path. Undefined for a relative path, which would resolve
// against the folder the program runs in, one the task's steps write to.
export function readBin(
  value: string | undefined,
  fallback: string,
): string | undefined {
  if (!value) {
    return fallback;
  }
  return value.includes('/') && !isAbsolute(value) ? undefined : value;
}
