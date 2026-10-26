import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect } from 'vitest';
import { received, writeFakeClaude } from '../../../fake-claude';
import { bin, goTask } from '../../../go-task';

// harness/claude-headless/Taskfile.yml run with go-task as the runner runs
// a claim's Taskfile: its default task, with the task's context as JSON in
// CONTEXT and the run's workspace in WORKSPACE, on the command line. Node
// runs its main.ts from source, as on a runner's machine, and it runs a
// fake claude, never the real one.

const taskfile = join(
  import.meta.dirname,
  '../../../../harness/claude-headless/Taskfile.yml',
);

let dir: string;
let workspace: string;
let claude: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-claude-headless-'));
  workspace = join(dir, 'workspace');
  mkdirSync(workspace);
  claude = writeFakeClaude(dir);
  file = join(dir, 'received.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Runs the default task with `context`, and resolves with go-task's exit
// code and what it wrote. The context goes as the runner writes it: JSON,
// every {{ written as its escape.
function run(context: Record<string, unknown>) {
  const json = JSON.stringify(context).replaceAll('{{', '{\\u007b');
  return new Promise<{ code: number; stdout: string; stderr: string }>(
    (resolve) => {
      execFile(
        bin,
        [
          '--exit-code',
          '--silent',
          '--taskfile',
          taskfile,
          'default',
          `CONTEXT=${json}`,
          `WORKSPACE=${workspace}`,
        ],
        {
          env: {
            ...process.env,
            CLAUDE_HEADLESS_BIN: claude,
            FAKE_CLAUDE_RECEIVED: file,
          },
        },
        (error, stdout, stderr) => {
          resolve({
            code: Number(error?.code ?? 0),
            stdout: stdout.trim(),
            stderr: stderr.trim(),
          });
        },
      );
    },
  );
}

goTask('Taskfile.yml runs claude -p as the context asks', async () => {
  await run({ prompt: 'hi', model: 'opus' });

  expect(received(file)).toMatchObject({
    args: ['-p', '--model=opus'],
    cwd: workspace,
    stdin: 'hi',
  });
});

goTask('Taskfile.yml passes on what claude writes on stdout', async () => {
  const { code, stdout } = await run({ prompt: 'hi' });

  expect({ code, stdout }).toEqual({
    code: 0,
    stdout: 'first line\nsecond line',
  });
});

goTask(
  'Taskfile.yml hands claude a context value as written, never as a template',
  async () => {
    await run({ prompt: 'write {{.WORKSPACE}} as is' });

    expect(received(file).stdin).toBe('write {{.WORKSPACE}} as is');
  },
);

goTask(
  'Taskfile.yml refuses a context: exit code 2, the reason on stderr',
  async () => {
    const { code, stderr } = await run({ model: 'opus' });

    // go-task adds a line of its own, after the script's.
    expect({ code, reason: stderr.split('\n')[0] }).toEqual({
      code: 2,
      reason: 'claude-headless: prompt is a string with text',
    });
  },
);
