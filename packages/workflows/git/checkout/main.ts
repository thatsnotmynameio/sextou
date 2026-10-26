// The checkout's entry point, which Taskfile.yml runs with node.
import { checkout } from './checkout.ts';

process.exitCode = await checkout(process.env, (line) => {
  process.stderr.write(`${line}\n`);
});
