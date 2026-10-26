import { isAbsolute, resolve, sep } from 'node:path';

// What a checkout clones, and where.
export interface Settings {
  // The repository's URL: the server's origin, then owner/name.
  url: string;
  // A full commit SHA, a branch or a tag.
  ref: string;
  // Where the repository is checked out: an absolute path inside the
  // workspace, or the workspace itself.
  path: string;
}

export type ReadSettings =
  | { ok: true; settings: Settings }
  | { ok: false; reason: string };

// A part of owner/name: letters, digits, _, . and -, the server's rule for a
// claim's repository.
const part = /^[\w.-]+$/;

// Reads a checkout's settings from the task's context, as JSON, and the
// run's workspace, an absolute path:
//
//   repo    owner/name, required
//   ref     a full commit SHA, a branch or a tag, required
//   path    where in the workspace, . by default
//   server  where repo lives, an https URL, https://github.com by default
//
// and refuses, with why, an input that would take git elsewhere than asked.
export function readSettings(context: string, workspace: string): ReadSettings {
  if (!isAbsolute(workspace)) {
    return refuse('workspace is an absolute path');
  }
  let input: unknown;
  // Stryker disable BlockStatement: an input left undefined refuses the same, below
  try {
    input = JSON.parse(context);
  } catch {
    return refuse('context is a JSON object');
  }
  // Stryker restore BlockStatement
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return refuse('context is a JSON object');
  }
  const {
    repo,
    ref,
    // Stryker disable next-line StringLiteral: an empty path resolves to the workspace too
    path = '.',
    server = 'https://github.com',
  } = input as Record<string, unknown>;

  // Neither part . nor .., which the URL would resolve to another path.
  const parts = typeof repo === 'string' ? repo.split('/') : undefined;
  if (
    parts?.length !== 2 ||
    !parts.every((name) => part.test(name) && name !== '.' && name !== '..')
  ) {
    return refuse('repo is owner/name');
  }

  // One that starts with - would reach git fetch as an option, and one with
  // : or * is a refspec, which fetches other refs and writes them. A NUL ends
  // no argument: spawn throws on it.
  if (
    typeof ref !== 'string' ||
    ref === '' ||
    ref.startsWith('-') ||
    /[:*\s\0]/.test(ref)
  ) {
    return refuse('ref is a commit, a branch or a tag');
  }

  // A NUL reaches no file: mkdir throws on it.
  const root = resolve(workspace);
  const destination =
    typeof path === 'string' && !path.includes('\0')
      ? resolve(root, path)
      : undefined;
  if (
    destination === undefined ||
    (destination !== root && !destination.startsWith(root + sep))
  ) {
    return refuse('path is inside the workspace');
  }

  // Only https: file:// would reach the repositories on the runner's own
  // disk, http:// travels unencrypted, and git's ext:: runs a command. Only
  // the origin counts, so a trailing slash or a path changes nothing.
  const origin = typeof server === 'string' ? URL.parse(server) : null;
  if (origin?.protocol !== 'https:') {
    return refuse('server is an https URL');
  }

  return {
    ok: true,
    settings: {
      url: `${origin.origin}/${parts[0]}/${parts[1]}`,
      ref,
      path: destination,
    },
  };
}

function refuse(reason: string): ReadSettings {
  return { ok: false, reason };
}

// How long the checkout's git may take, all its commands together: 5 minutes
// unless CHECKOUT_TIMEOUT_MS, from the runner's environment, sets another
// whole number of milliseconds, from 1 to 2147483647, the most a timer
// takes, as the runner's own settings. Undefined when it is set to anything
// else.
export const defaultTimeoutMs = 300_000;

export function readTimeout(value: string | undefined): number | undefined {
  if (value === undefined) {
    return defaultTimeoutMs;
  }
  const ms = Number(value);
  return /^[1-9]\d*$/.test(value) && ms <= 2147483647 ? ms : undefined;
}
