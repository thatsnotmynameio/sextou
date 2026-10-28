import { insideWorkspace, readContext } from '../../shared/settings.ts';

// What every harness's run reads from the task's context the same way.
export interface Input {
  // Every field of the context, for the harness to read its own options
  // from.
  fields: Record<string, unknown>;
  // Where the harness runs: an absolute path inside the workspace, or the
  // workspace itself.
  cwd: string;
  // What the harness is asked, through its stdin, never as an argument.
  prompt: string;
}

export type ReadInput =
  | { ok: true; input: Input }
  | { ok: false; reason: string };

// Reads a run's input from the task's context, as JSON, and the run's
// workspace, an absolute path:
//
//   prompt  what the harness is asked, required
//   path    where in the workspace it runs, . by default
//
// Every other field is the harness's to read, or left for the other steps
// of the run, such as a checkout before it.
export function readInput(context: string, workspace: string): ReadInput {
  const read = readContext(context, workspace);
  if (!read.ok) {
    return read;
  }
  const { fields } = read;
  // Stryker disable next-line StringLiteral: an empty path resolves to the workspace too
  const { prompt, path = '.' } = fields;

  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return refuse('prompt is a string with text');
  }

  const cwd = insideWorkspace(workspace, path);
  if (cwd === undefined) {
    return refuse('path is inside the workspace');
  }

  return { ok: true, input: { fields, cwd, prompt } };
}

function refuse(reason: string): ReadInput {
  return { ok: false, reason };
}
