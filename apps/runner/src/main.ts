// The runner's entry point: `pnpm --filter @sextou/runner dev` runs it from
// source, and loads apps/runner/.env when it exists.
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { createRunnerClient } from './client';
import { loadConfig, type Config } from './config';
import { createLogger } from './logger';
import { startRunner } from './runner';

const config = readConfig();
if (config) {
  run(config);
}

// An invalid variable stops the runner before it calls the server. The error
// goes through a logger at the default level: the configured one isn't read
// yet, and may be the invalid variable.
function readConfig(): Config | undefined {
  try {
    return loadConfig(process.env, { hostname });
  } catch (error) {
    createLogger({ level: 'info', pretty: false }).error(
      (error as Error).message,
    );
    process.exitCode = 1;
    return undefined;
  }
}

function run(config: Config) {
  const logger = createLogger({ level: config.logLevel, pretty: config.dev });
  const runner = startRunner({
    client: createRunnerClient(config.serverUrl, config.requestTimeoutMs),
    name: config.name,
    assignees: config.assignees,
    pollMs: config.pollMs,
    holdMs: config.holdMs,
    logger,
    newId: randomUUID,
  });
  logger.info(
    {
      name: config.name,
      assignees: config.assignees,
      serverUrl: config.serverUrl,
    },
    'started',
  );

  // The first signal stops once; a second one gets Node's default exit,
  // which ends a stop stuck on a call in flight.
  const shutdown = async () => {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    await runner.stop();
    logger.info('stopped');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
