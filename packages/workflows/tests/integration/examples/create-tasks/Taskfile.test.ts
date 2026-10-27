import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect } from 'vitest';
import { bin, goTask } from '../../../go-task';

// examples/create-tasks/Taskfile.yml run with go-task as the runner runs a
// claim's Taskfile: its default task, with the task's context as JSON in
// CONTEXT, every {{ written as its escape, and the path to write in
// TASKS_FILE, on the command line.

const taskfile = join(
  import.meta.dirname,
  '../../../../examples/create-tasks/Taskfile.yml',
);

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-create-tasks-'));
  file = join(dir, 'tasks.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Runs the default task with `context`, and resolves with go-task's exit code.
function run(context: Record<string, unknown>) {
  const json = JSON.stringify(context).replaceAll('{{', '{\\u007b');
  return new Promise<number>((resolve) => {
    execFile(
      bin,
      [
        '--exit-code',
        '--silent',
        '--taskfile',
        taskfile,
        'default',
        `CONTEXT=${json}`,
        `TASKS_FILE=${file}`,
      ],
      (error) => resolve(Number(error?.code ?? 0)),
    );
  });
}

goTask(
  'Taskfile.yml writes a context of two tasks to TASKS_FILE as JSON',
  async () => {
    const context = {
      tasks: [
        { title: 'first', assignee: 'a' },
        { title: 'second', assignee: 'b', blockedBy: [0] },
      ],
    };

    const code = await run(context);

    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(context);
  },
);

goTask(
  'Taskfile.yml writes a {{ in a value of the context verbatim',
  async () => {
    const context = {
      tasks: [{ title: "{{.WORKSPACE}} 'quoted' $HOME `x`", assignee: 'a' }],
    };

    const code = await run(context);

    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(context);
  },
);
