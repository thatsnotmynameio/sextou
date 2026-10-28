import { stat } from 'node:fs/promises';
import { run } from '../../shared/run.ts';
import { throughSymlink } from '../../shared/workspace.ts';
import { readInput } from './settings.ts';

// Exits with 2 on an input it refuses, having run no program.
export const refused = 2;
// Exits with 127 when the program doesn't run.
export const notRun = 127;
// Exits with 124 when the program took longer than the harness's timeout,
// which stops it, as timeout(1) does: SIGTERM, then SIGKILL once the
// harness's grace went by.
export const timedOut = 124;

// How a harness runs for one context.
export type Prepared =
  | {
      ok: true;
      // The program, a command on the PATH or an absolute path.
      bin: string;
      // Its arguments, the prompt never among them.
      args: string[];
      timeoutMs: number;
      killGraceMs: number;
    }
  | { ok: false; reason: string };

// What an action hands the core about the agent CLI it runs. The core reads
// the context, the path and the prompt the same way for every harness; the
// harness says the rest.
export interface Harness {
  // The name each reason the core writes starts with, such as
  // claude-headless.
  name: string;
  // The program's name in those reasons, such as claude, whatever path it
  // runs from.
  program: string;
  // The prefix of the harness's own variables, kept from the program's
  // environment.
  ownVariables: string;
  // How it runs for the context's fields, or why it refuses them or its own
  // settings.
  prepare: (fields: Record<string, unknown>) => Prepared;
  // Why the run can't start, once the path checked out; undefined when it
  // can.
  check?: () => Promise<string | undefined>;
}

// A run's input, as the action read it: the task's context, as JSON, the
// run's workspace, and the environment the program runs with.
export interface Run {
  context: string;
  workspace: string;
  env: NodeJS.ProcessEnv;
}

// Where each line the program writes goes, by the stream it wrote it to.
export interface Output {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

// Runs `harness` in the run's workspace, at the context's path, with the
// context's prompt on its stdin, after `program --version` answered. Its
// environment is `env` but for the harness's own variables. Resolves with
// the exit code: refused, notRun, timedOut, else the program's.
export async function runHarness(
  harness: Harness,
  { context, workspace, env }: Run,
  output: Output,
): Promise<number> {
  const refuse = (reason: string) => {
    output.stderr(`${harness.name}: ${reason}`);
    return refused;
  };
  const read = readInput(context, workspace);
  if (!read.ok) {
    return refuse(read.reason);
  }
  const { fields, cwd, prompt } = read.input;
  const prepared = harness.prepare(fields);
  if (!prepared.ok) {
    return refuse(prepared.reason);
  }
  if (await throughSymlink(workspace, cwd)) {
    return refuse('path is inside the workspace');
  }
  if (!(await stat(cwd).catch(() => undefined))?.isDirectory()) {
    return refuse('path is a folder');
  }
  const why = await harness.check?.();
  if (why !== undefined) {
    return refuse(why);
  }
  const { bin, args, timeoutMs, killGraceMs } = prepared;
  const programEnv = Object.fromEntries(
    Object.entries(env).filter(
      ([name]) => !name.startsWith(harness.ownVariables),
    ),
  );
  // A program that hangs on --version doesn't run either.
  const deadline = AbortSignal.timeout(timeoutMs);
  const options = { cwd, env: programEnv, signal: deadline, killGraceMs };
  if ((await run(bin, ['--version'], options, notRun)) !== 0) {
    output.stderr(`${harness.name}: ${harness.program} does not run`);
    return notRun;
  }
  const code = await run(
    bin,
    args,
    { ...options, stdin: prompt, ...output },
    notRun,
  );
  if (deadline.aborted) {
    output.stderr(
      `${harness.name}: ${harness.program} took longer than ${timeoutMs} ms`,
    );
    return timedOut;
  }
  return code;
}
