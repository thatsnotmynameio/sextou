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
import { createLogger } from './logger';
import { startServer } from './server';

const config = readConfig();
if (config) {
  await serve(config);
}

// An invalid variable stops the server before it listens. The error goes
// through a logger at the default level: the configured one isn't read yet,
// and may be the invalid variable.
function readConfig(): Config | undefined {
  try {
    return loadConfig(process.env, {
      platform: process.platform,
      homedir,
      cwd: process.cwd(),
    });
  } catch (error) {
    createLogger({ level: 'info', pretty: false }).error(
      (error as Error).message,
    );
    process.exitCode = 1;
    return undefined;
  }
}

async function serve(config: Config) {
  const logger = createLogger({
    level: config.logLevel,
    pretty: config.dev,
  });

  // Turso creates the file but not its folder. A folder it can't create
  // doesn't stop the server: health reports the database down.
  if (config.database !== ':memory:') {
    const folder = dirname(config.database);
    try {
      mkdirSync(folder, { recursive: true });
    } catch (error) {
      logger.error(
        { folder, err: error },
        "Could not create the database's folder",
      );
    }
  }

  const database = createDatabase(config.database, config.databaseTimeoutMs);
  const app = createApp({
    version: packageJson.version,
    database: { ping: database.ping },
    dev: config.dev,
    logger,
    webOrigin: config.webOrigin,
  });
  const server = await startServer(app, config).catch(
    async (error: unknown) => {
      await database.close();
      throw error;
    },
  );
  // A URL needs an IPv6 address in brackets. A process that starts the server
  // reads the URL from this record.
  const urlHost = server.host.includes(':') ? `[${server.host}]` : server.host;
  logger.info({ url: `http://${urlHost}:${server.port}` }, 'listening');

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
