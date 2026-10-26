// claude-headless's entry point, which Taskfile.yml runs with node.
import { headless } from './headless.ts';

process.exitCode = await headless(process.env, {
  stdout: (line) => {
    process.stdout.write(`${line}\n`);
  },
  stderr: (line) => {
    process.stderr.write(`${line}\n`);
  },
});
