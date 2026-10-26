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
  // : or * is a refspec, which fetches other refs and writes them.
  if (
    typeof ref !== 'string' ||
    ref === '' ||
    ref.startsWith('-') ||
    /[:*\s]/.test(ref)
  ) {
    return refuse('ref is a commit, a branch or a tag');
  }

  const root = resolve(workspace);
  const destination =
    typeof path === 'string' ? resolve(root, path) : undefined;
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
