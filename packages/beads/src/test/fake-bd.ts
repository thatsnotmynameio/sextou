// A fake bd: records its call and acts out `init`, `config set` and `serve`
// as the real one does. Usage: fake-bd.ts <calls> <mode> <bd arguments...>
// Modes: normal; init-fails, which prints the Dolt password to stderr and
// fails; serve-503, which never gets ready; serve-exit, which fails at once.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const [calls, mode, ...argv] = process.argv.slice(2);
// The wrapper's shell adds PWD and SHLVL; the rest is what bd was given.
const { PWD: _pwd, SHLVL: _shlvl, ...env } = process.env;
appendFileSync(
  calls,
  `${JSON.stringify({ pid: process.pid, argv, env, cwd: process.cwd() })}\n`,
);

const beadsDir = env.BEADS_DIR as string;
const option = (name: string) => argv[argv.indexOf(name) + 1];

if (argv[0] === 'init') {
  if (mode === 'init-fails') {
    console.error(`fake bd: cannot log in with ${env.BEADS_DOLT_PASSWORD}`);
    process.exit(1);
  }
  // --init-if-missing: an initialized folder is left as it is.
  if (!existsSync(join(beadsDir, 'metadata.json'))) {
    mkdirSync(beadsDir, { recursive: true });
    writeFileSync(
      join(beadsDir, 'metadata.json'),
      JSON.stringify({ dolt_database: option('--database') }),
    );
    writeFileSync(join(beadsDir, 'config.yaml'), '');
    console.log('created');
  }
} else if (argv[0] === 'config') {
  appendFileSync(join(beadsDir, 'config.yaml'), `${argv[2]}: ${argv[3]}\n`);
} else if (argv[0] === 'serve') {
  // bd serve runs git to find the root of the folder it serves.
  if (mode === 'serve-exit' || !existsSync(join(process.cwd(), '.git'))) {
    console.error('fake bd: cannot determine repository root');
    process.exit(1);
  }
  const token = readFileSync(option('--auth-token-file'), 'utf8');
  const [host, port] = option('--addr').split(':');
  createServer((request, response) => {
    const authorized = request.headers.authorization === `Bearer ${token}`;
    const status = !authorized ? 401 : mode === 'serve-503' ? 503 : 200;
    response.writeHead(status).end();
  }).listen(Number(port), host);
  process.on('SIGTERM', () => process.exit(0));
}
