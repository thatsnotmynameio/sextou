// The server's entry point: `pnpm --filter @sextou/server dev` runs it from
// source, dist/server.mjs is its build. Both load apps/server/.env when it
// exists.
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import packageJson from '../package.json';
import { createApp } from './app';
import { loadConfig, type Config } from './config';
import { createDatabase } from './database';
import { startServer } from './server';

const config = readConfig();
if (config) {
  await serve(config);
}

// An invalid variable stops the server before it listens.
function readConfig(): Config | undefined {
  try {
    return loadConfig(process.env, {
      platform: process.platform,
      homedir,
      cwd: process.cwd(),
    });
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return undefined;
  }
}

async function serve(config: Config) {
  // Turso creates the file but not its folder. A folder it can't create
  // doesn't stop the server: health reports the database down.
  if (config.database !== ':memory:') {
    const folder = dirname(config.database);
    try {
      mkdirSync(folder, { recursive: true });
    } catch (error) {
      console.error(
        `Could not create the database's folder ${folder}: ${(error as Error).message}`,
      );
    }
  }

  const database = createDatabase(config.database, config.databaseTimeoutMs);
  const app = createApp({
    version: packageJson.version,
    database: { ping: database.ping },
    dev: config.dev,
    webOrigin: config.webOrigin,
  });
  const server = await startServer(app, config).catch(
    async (error: unknown) => {
      await database.close();
      throw error;
    },
  );
  // A URL needs an IPv6 address in brackets.
  const urlHost = server.host.includes(':') ? `[${server.host}]` : server.host;
  console.log(`listening on http://${urlHost}:${server.port}`);

  // The first signal shuts down once; a second one gets Node's default exit,
  // which ends a shutdown stuck on a request in flight.
  const shutdown = async () => {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    await server.close();
    await database.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
