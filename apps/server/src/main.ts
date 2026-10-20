// The server's entry point: `pnpm --filter @sextou/server dev` runs it from
// source, dist/server.mjs is its build.
import { homedir } from 'node:os';
import { openDatabase, type Database } from '@sextou/data';
import packageJson from '../package.json';
import { createApp } from './app';
import { loadConfig } from './config';
import { startServer } from './server';

const config = loadConfig(process.env, process.argv.slice(2), {
  platform: process.platform,
  homedir,
  cwd: process.cwd(),
});

// The database opens before the server listens: without it, no feature
// works. SQLite's own message doesn't name the file, so this one does.
let database: Database | undefined;
try {
  database = openDatabase(config.database);
} catch (error) {
  console.error(
    `Could not open the database at ${config.database}: ${(error as Error).message}`,
  );
  process.exitCode = 1;
}

if (database) await serve(database);

async function serve(database: Database) {
  const app = createApp({
    version: packageJson.version,
    startedAt: new Date(),
    now: () => new Date(),
    pingDatabase: database.ping,
  });
  const server = await startServer(app, config).catch((error: unknown) => {
    database.close();
    throw error;
  });
  // A URL needs an IPv6 address in brackets.
  const urlHost = server.host.includes(':') ? `[${server.host}]` : server.host;
  console.log(`listening on http://${urlHost}:${server.port}`);

  // The first signal shuts down once; a second one gets Node's default exit,
  // which ends a shutdown stuck on a request in flight.
  const shutdown = async () => {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    await server.close();
    database.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
