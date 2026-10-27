import { spawnSync } from 'node:child_process';
import { test } from 'vitest';

// go-task from the host, as `task` on the PATH. The organization's
// typescript.yml runs the integration suite with no go-task installed, so the
// tests that need it skip there; checks.yml installs it, and
// test:integration's coverage floor fails when they skip. Another `task`,
// such as Taskwarrior's, has no --taskfile.
export const bin = 'task';
const help = spawnSync(bin, ['--help'], { encoding: 'utf8' });
export const goTask = test.skipIf(
  !`${help.stdout}${help.stderr}`.includes('--taskfile'),
);
