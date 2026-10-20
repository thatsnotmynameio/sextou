// A fake `dolt sql-server`: records its call, writes the files the real one
// writes and listens on its port. Usage: fake-dolt.ts <calls> <mode> sql-server
// -H <host> -P <port> --data-dir <dir> ...
// Modes: normal; exit (fails at once); never-ready (never listens).
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

const [calls, mode, ...argv] = process.argv.slice(2);
// The wrapper's shell adds PWD and SHLVL; the rest is what dolt was given.
const { PWD: _pwd, SHLVL: _shlvl, ...env } = process.env;
appendFileSync(
  calls,
  `${JSON.stringify({ pid: process.pid, argv, env, cwd: process.cwd() })}\n`,
);

const option = (name: string) => argv[argv.indexOf(name) + 1];
const port = Number(option('-P'));
const dataDir = option('--data-dir');

if (mode === 'exit') {
  console.error('fake dolt: could not start');
  process.exit(1);
}

mkdirSync(join(dataDir, '.doltcfg'), { recursive: true });
writeFileSync(join(dataDir, '.doltcfg', 'privileges.db'), '', { flag: 'a' });
const info = join(dataDir, '.dolt', 'sql-server.info');

process.on('SIGTERM', () => {
  rmSync(info, { force: true });
  process.exit(0);
});

if (mode === 'never-ready') {
  setInterval(() => {}, 1000);
} else {
  createServer((socket) => socket.end()).listen(port, '127.0.0.1', () => {
    mkdirSync(join(dataDir, '.dolt'), { recursive: true });
    writeFileSync(info, `${process.pid}:${port}:secret`);
  });
}
