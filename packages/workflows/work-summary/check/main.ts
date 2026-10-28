// The check's entry point, which Taskfile.yml runs with node.
import { check } from './check.ts';

process.exitCode = await check(process.env, (line) => {
  process.stderr.write(`${line}\n`);
});
