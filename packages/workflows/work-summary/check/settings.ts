import { insideWorkspace, readContext } from '../../shared/settings.ts';

// What the check reads, and where.
export interface Settings {
  // The repository: an absolute path inside the workspace, or the workspace
  // itself.
  path: string;
  // The base ref the branch left.
  base: string;
  // The plan: its path in the repository, and the absolute one.
  plan: string;
  planFile: string;
  // Exact paths in the repository the check counts on neither side.
  ignore: string[];
  // The summary file: an absolute path inside the workspace.
  summary: string;
}

export type ReadSettings =
  | { ok: true; settings: Settings }
  | { ok: false; reason: string };

// Reads the check's settings from the task's context, as JSON, and the run's
// workspace, an absolute path:
//
//   path     the repository in the workspace, . by default
//   base     the base ref, required
//   plan     the plan's path in the repository, required
//   ignore   exact paths in the repository to ignore, [] by default
//   summary  the summary file's path in the workspace, required
//
// and refuses, with why, the first field that is wrong.
export function readSettings(context: string, workspace: string): ReadSettings {
  const input = readContext(context, workspace);
  if (!input.ok) {
    return input;
  }
  const {
    // Stryker disable next-line StringLiteral: an empty path resolves to the workspace too
    path = '.',
    base,
    plan,
    ignore = [],
    summary,
  } = input.fields;

  const repository = insideWorkspace(workspace, path);
  if (repository === undefined) {
    return refuse('path is inside the workspace');
  }

  // One that starts with - would reach git as an option. A NUL ends no
  // argument: spawn throws on it.
  if (
    typeof base !== 'string' ||
    base === '' ||
    base.startsWith('-') ||
    base.includes('\0')
  ) {
    return refuse('base is a ref');
  }

  const planFile = insideWorkspace(repository, plan);
  if (typeof plan !== 'string' || planFile === undefined) {
    return refuse('plan is a path in the repository');
  }

  if (
    !Array.isArray(ignore) ||
    !ignore.every((item) => typeof item === 'string')
  ) {
    return refuse('ignore is a list of paths');
  }

  const summaryFile = insideWorkspace(workspace, summary);
  if (summaryFile === undefined) {
    return refuse('summary is a path inside the workspace');
  }

  return {
    ok: true,
    settings: {
      path: repository,
      base,
      plan,
      planFile,
      ignore,
      summary: summaryFile,
    },
  };
}

function refuse(reason: string): ReadSettings {
  return { ok: false, reason };
}

// How long the check's git may take, all its commands together: a minute
// unless WORK_SUMMARY_TIMEOUT_MS, from the runner's environment, sets
// another.
export const defaultTimeoutMs = 60_000;
