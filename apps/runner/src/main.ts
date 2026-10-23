// The runner's entry point: `pnpm --filter @sextou/runner dev` runs it from
// source, dist/runner.mjs is its build. Both load apps/runner/.env when it
// exists.
import { createClient } from './client';
import { loadConfig, type Config } from './config';
import { createLogger } from './logger';
import { poll } from './poll';

const config = readConfig();
if (config) {
  await run(config);
}

// An invalid variable stops the runner before it asks anything. The error
// goes through a logger at the default level: the configured one isn't read
// yet, and may be the invalid variable.
function readConfig(): Config | undefined {
  try {
    return loadConfig(process.env);
  } catch (error) {
    createLogger({ level: 'info', pretty: false }).error(
      (error as Error).message,
    );
    process.exitCode = 1;
    return undefined;
  }
}

async function run(config: Config) {
  const logger = createLogger({ level: config.logLevel, pretty: config.dev });

  // The first signal stops the loop, aborting a request in flight; a second
  // one gets Node's default exit.
  const controller = new AbortController();
  const stop = () => {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    controller.abort();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  logger.info(
    { url: config.serverUrl, intervalMs: config.pollIntervalMs },
    'polling',
  );
  await poll({
    client: createClient(config.serverUrl, config.requestTimeoutMs),
    intervalMs: config.pollIntervalMs,
    logger,
    signal: controller.signal,
  });
  // Nothing else keeps the process alive: it ends here, with exit code 0.
  logger.info('stopped');
}
