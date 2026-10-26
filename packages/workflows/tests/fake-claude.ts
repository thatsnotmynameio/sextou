import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// What the fake claude got on a run: its arguments, the folder it ran in,
// its stdin and the names, never the values, of its environment's variables.
interface Received {
  args: string[];
  cwd: string;
  stdin: string;
  env: string[];
}

// A claude for the tests, so none runs the real one. --version prints a
// version, and a notice on stderr, and exits with FAKE_CLAUDE_VERSION_EXIT, 0 by
// default. With FAKE_CLAUDE_SKIP_STDIN=1, any other call exits at once with
// FAKE_CLAUDE_EXIT, reading nothing. Otherwise it reads its stdin,
// writes what it got to the file FAKE_CLAUDE_RECEIVED names, prints two
// fixed lines on stdout and one on stderr, then kills itself with
// FAKE_CLAUDE_SIGNAL when it is set, else exits with FAKE_CLAUDE_EXIT, 0 by
// default, after FAKE_CLAUDE_SLEEP_MS when it is set.
const script = `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
const env = process.env;
if (process.argv[2] === '--version') {
  process.stdout.write('0.0.0 (Fake Claude)\\n');
  process.stderr.write('a notice\\n');
  process.exit(Number(env.FAKE_CLAUDE_VERSION_EXIT ?? 0));
}
if (env.FAKE_CLAUDE_SKIP_STDIN === '1') {
  process.exit(Number(env.FAKE_CLAUDE_EXIT ?? 0));
}
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', () => {
  writeFileSync(env.FAKE_CLAUDE_RECEIVED, JSON.stringify({
    args: process.argv.slice(2),
    cwd: process.cwd(),
    stdin,
    env: Object.keys(env),
  }));
  process.stdout.write('first line\\nsecond line\\n');
  process.stderr.write('a warning\\n');
  if (env.FAKE_CLAUDE_SIGNAL) {
    process.kill(process.pid, env.FAKE_CLAUDE_SIGNAL);
  }
  setTimeout(
    () => process.exit(Number(env.FAKE_CLAUDE_EXIT ?? 0)),
    Number(env.FAKE_CLAUDE_SLEEP_MS ?? 0),
  );
});
`;

// Writes the fake claude into `dir`, runnable, and returns its path.
export function writeFakeClaude(dir: string) {
  const path = join(dir, 'claude');
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

// What the fake claude wrote to `file` on its run.
export function received(file: string): Received {
  return JSON.parse(readFileSync(file, 'utf8')) as Received;
}
