// The runner's entry point: `pnpm --filter @sextou/runner dev` runs it from
// source, and loads apps/runner/.env when it exists.
import { randomUUID } from 'node:crypto';
import { constants, hostname } from 'node:os';
import { createRunnerClient } from './client';
import { loadConfig, type Config } from './config';
import { createLogger, type Logger } from './logger';
import { startRunner } from './runner';
import { checkGoTask, taskfileExecute } from './taskfile';

const config = readConfig();
if (config) {
  void start(config);
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

// A runner whose go-task doesn't run would fail every task it claims: it
// stops before it calls the server instead.
async function start(config: Config) {
  const logger = createLogger({ level: config.logLevel, pretty: config.dev });
  const reason = await checkGoTask(config.taskBin, config.checkTimeoutMs);
  if (reason !== undefined) {
    logger.error(
      { taskBin: config.taskBin, reason },
      'SEXTOU_RUNNER_TASK_BIN is not go-task',
    );
    process.exitCode = 1;
    return;
  }
  run(config, logger);
}

function run(config: Config, logger: Logger) {
  const runner = startRunner({
    client: createRunnerClient(config.serverUrl, config.requestTimeoutMs),
    name: config.name,
    assignees: config.assignees,
    pollMs: config.pollMs,
    execute: taskfileExecute({
      bin: config.taskBin,
      timeoutMs: config.runTimeoutMs,
      killGraceMs: config.killGraceMs,
    }),
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

  // The first signal stops once; a second one exits at once with the
  // signal's code, which ends a stop stuck on a call in flight. It exits
  // through process.exit rather than Node's default, so the exit handlers
  // still run, which kill a run's processes.
  const exitNow = (signal: NodeJS.Signals) => {
    process.exit(128 + constants.signals[signal]);
  };
  const shutdown = async () => {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    process.on('SIGINT', exitNow);
    process.on('SIGTERM', exitNow);
    await runner.stop();
    logger.info('stopped');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
