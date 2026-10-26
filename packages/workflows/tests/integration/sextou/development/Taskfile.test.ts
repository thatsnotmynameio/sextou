import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';
import { received, writeFakeClaude } from '../../../fake-claude';
import { serveGit, type GitServer } from '../../../git-server';
import { bin, goTask } from '../../../go-task';
import { git, isolateGit, repository } from '../../../repository';

// sextou/development/Taskfile.yml run with go-task as the runner runs a
// claim's Taskfile: its default task, with the task's context as JSON in
// CONTEXT and the run's workspace in WORKSPACE, on the command line. Node
// runs the main.ts of each Taskfile it includes from source, as on a
// runner's machine: the checkout's git against the git server, and a fake
// claude, never the real one.

const taskfile = join(
  import.meta.dirname,
  '../../../../sextou/development/Taskfile.yml',
);

let served: string;
let server: GitServer;
let dir: string;
let workspace: string;
let claude: string;
let file: string;

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
  dir = mkdtempSync(join(tmpdir(), 'sextou-development-'));
  workspace = join(dir, 'workspace');
  mkdirSync(workspace);
  claude = writeFakeClaude(dir);
  file = join(dir, 'received.json');
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
  rmSync(join(served, 'org'), { recursive: true, force: true });
});

// Runs the default task with `context`, from the git server, and `env` on
// top of the process's, and resolves with go-task's exit code and what it
// wrote. The context goes as the runner writes it: JSON, every {{ written
// as its escape.
function run(context: Record<string, unknown>, env: NodeJS.ProcessEnv = {}) {
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
        {
          env: {
            ...process.env,
            CLAUDE_HEADLESS_BIN: claude,
            FAKE_CLAUDE_RECEIVED: file,
            ...env,
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

goTask(
  'Taskfile.yml checks out the ref of the context into its path',
  async () => {
    const { first } = repository(served);

    await run({ repo: 'org/app', ref: first, path: 'code', prompt: 'hi' });

    expect(git(join(workspace, 'code'), 'rev-parse', 'HEAD')).toBe(first);
  },
);

goTask(
  'Taskfile.yml runs claude in the checkout with the prompt of the context',
  async () => {
    repository(served);

    await run({ repo: 'org/app', ref: 'main', path: 'code', prompt: 'hi' });

    expect(received(file)).toMatchObject({
      cwd: join(workspace, 'code'),
      stdin: 'hi',
    });
  },
);

goTask('Taskfile.yml passes on what claude writes on stdout', async () => {
  repository(served);

  const { code, stdout } = await run({
    repo: 'org/app',
    ref: 'main',
    prompt: 'hi',
  });

  expect({ code, stdout }).toEqual({
    code: 0,
    stdout: 'first line\nsecond line',
  });
});

goTask('Taskfile.yml runs no claude when the checkout is refused', async () => {
  const { code } = await run({ ref: 'main', prompt: 'hi' });

  expect({ code, ran: existsSync(file) }).toEqual({ code: 2, ran: false });
});

goTask('Taskfile.yml exits with claude’s code when claude fails', async () => {
  repository(served);

  const { code } = await run(
    { repo: 'org/app', ref: 'main', prompt: 'hi' },
    { FAKE_CLAUDE_EXIT: '3' },
  );

  expect(code).toBe(3);
});
