import { execFile } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';
import { serveGit, type GitServer } from '../../../git-server';
import { bin, goTask } from '../../../go-task';
import { git, isolateGit, repository } from '../../../repository';

// git/checkout/Taskfile.yml run with go-task as the runner runs a claim's
// Taskfile: its default task, with the task's context as JSON in CONTEXT and
// the run's workspace in WORKSPACE, on the command line. Node runs its
// main.ts from source, as on a runner's machine.

const folder = join(import.meta.dirname, '../../../../git/checkout');

let served: string;
let server: GitServer;
let dir: string;
let workspace: string;

beforeAll(async () => {
  served = mkdtempSync(join(tmpdir(), 'sextou-served-'));
  server = await serveGit(served);
});

afterAll(async () => {
  await server.close();
  rmSync(served, { recursive: true, force: true });
});

beforeEach(() => {
  isolateGit();
  // The git server's certificate, which no system trusts.
  vi.stubEnv('GIT_SSL_CAINFO', server.ca);
  dir = mkdtempSync(join(tmpdir(), 'sextou-checkout-'));
  workspace = join(dir, 'workspace');
  mkdirSync(workspace);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
  rmSync(join(served, 'org'), { recursive: true, force: true });
});

// Runs the default task of `taskfile` with `context`, from the git server
// unless it names its own, and resolves with go-task's exit code and what
// it wrote. The context goes as the runner writes it: JSON, every {{ written
// as its escape.
function run(
  context: Record<string, unknown>,
  taskfile = join(folder, 'Taskfile.yml'),
) {
  const json = JSON.stringify({ server: server.url, ...context }).replaceAll(
    '{{',
    '{\\u007b',
  );
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

goTask(
  'Taskfile.yml checks out the repository and ref of the context into the workspace',
  async () => {
    const { first } = repository(served);

    expect((await run({ repo: 'org/app', ref: first })).code).toBe(0);
    expect(git(workspace, 'rev-parse', 'HEAD')).toBe(first);
  },
);

goTask('Taskfile.yml checks out into the path of the context', async () => {
  repository(served);

  await run({ repo: 'org/app', ref: 'main', path: 'code' });

  expect(readdirSync(workspace)).toEqual(['code']);
});

goTask(
  'Taskfile.yml exits with 2 and why when the context is refused',
  async () => {
    const { code, stderr } = await run({ ref: 'main' });

    expect(code).toBe(2);
    expect(stderr.split('\n')).toContain('checkout: repo is owner/name');
  },
);

goTask(
  'Taskfile.yml hands the script a context value as written, never as a template',
  async () => {
    repository(served);

    await run({ repo: 'org/app', ref: 'main', path: '{{.WORKSPACE}}' });

    expect(readdirSync(workspace)).toEqual(['{{.WORKSPACE}}']);
  },
);

goTask(
  'Taskfile.yml checks out into the workspace when another Taskfile includes it',
  async () => {
    const { first } = repository(served);
    const tasks = join(dir, 'tasks');
    cpSync(join(folder, '..'), join(tasks, 'git'), { recursive: true });
    mkdirSync(join(tasks, 'build'));
    const taskfile = join(tasks, 'build/Taskfile.yml');
    writeFileSync(
      taskfile,
      [
        'version: "3"',
        'includes:',
        '  checkout: ../git/checkout',
        'tasks:',
        '  default:',
        '    cmds:',
        '      - task: checkout:default',
        '      - cat {{.WORKSPACE | q}}/file.txt',
      ].join('\n'),
    );

    expect(await run({ repo: 'org/app', ref: first }, taskfile)).toEqual({
      code: 0,
      stdout: 'first',
      stderr: '',
    });
  },
);
