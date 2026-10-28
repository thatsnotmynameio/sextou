import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { bin, goTask } from '../../../go-task';
import { git, isolateGit } from '../../../repository';

// work-summary/check/Taskfile.yml run with go-task as the runner runs a
// claim's Taskfile: its default task, with the task's context as JSON in
// CONTEXT and the run's workspace in WORKSPACE, on the command line. Node
// runs its main.ts from source, as on a runner's machine.

const taskfile = join(
  import.meta.dirname,
  '../../../../work-summary/check/Taskfile.yml',
);

let dir: string;
let workspace: string;

// A repository in the workspace whose branch, work, commits the plan and a.ts
// for U1.
beforeEach(() => {
  isolateGit();
  dir = mkdtempSync(join(tmpdir(), 'sextou-work-summary-'));
  workspace = join(dir, 'workspace');
  const repo = join(workspace, 'repo');
  mkdirSync(join(repo, 'docs'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'first');
  git(repo, 'switch', '-q', '-c', 'work');
  writeFileSync(join(repo, 'docs/plan.md'), '### U1. The first\n');
  writeFileSync(join(repo, 'a.ts'), 'a');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'feat: a', '-m', 'Units: U1');
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

// Writes a summary of U1, whose changed_files is `changed`, beside the
// repository.
function write(changed: string[]) {
  writeFileSync(
    join(workspace, 'summary.json'),
    JSON.stringify({
      status: 'complete',
      changed_files: changed,
      u_ids_attempted: ['U1'],
      u_ids_completed: ['U1'],
      verification: [],
      verification_evidence: [
        {
          unit: 'U1',
          behavior_changed: false,
          tests: { inspected: [], added_or_changed: [], used_unchanged: [] },
          red: null,
          verification: [],
          exception: null,
        },
      ],
      settled_decision_conflicts: [],
      behavior_change: false,
      blockers: [],
    }),
  );
}

// Runs the default task with a context that checks that summary, and
// resolves with go-task's exit code and what it wrote.
function run() {
  const context = JSON.stringify({
    path: 'repo',
    base: 'main',
    plan: 'docs/plan.md',
    ignore: ['docs/plan.md'],
    summary: 'summary.json',
  });
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
          `CONTEXT=${context}`,
          `WORKSPACE=${workspace}`,
        ],
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

goTask('Taskfile.yml exits with 0 on a valid summary', async () => {
  write(['a.ts']);

  expect(await run()).toEqual({ code: 0, stdout: '', stderr: '' });
});

goTask(
  'Taskfile.yml exits with 1 on a refused summary, with the reason on stderr',
  async () => {
    write([]);

    const { code, stderr } = await run();

    expect(code).toBe(1);
    expect(stderr.split('\n')).toContain(
      'work-summary: changed_files lacks a.ts, which the branch changed',
    );
  },
);
