import { spawnSync } from 'node:child_process';
import { test } from 'vitest';

// go-task from the host, as `task` on the PATH, as the runner's tests take
// it. The organization's typescript.yml runs the integration suite with no
// go-task installed, so the tests that need it skip there; checks.yml installs
// it. Another `task`, such as Taskwarrior's, has no --taskfile.
export const bin = 'task';
const help = spawnSync(bin, ['--help'], { encoding: 'utf8' });
export const goTask = test.skipIf(
  !`${help.stdout}${help.stderr}`.includes('--taskfile'),
);
