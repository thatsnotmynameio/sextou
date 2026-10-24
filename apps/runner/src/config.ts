// Pino's level names, written out here so config.ts doesn't import Pino, which
// leaves out silent from its own list.
const logLevels = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

export type LogLevel = (typeof logLevels)[number];

export interface Config {
  // Where the server answers: the client calls `${serverUrl}/trpc`.
  serverUrl: string;
  // The runner's name, which the server records on each claim and completion.
  name: string;
  // The assignees whose tasks the runner takes.
  assignees: string[];
  // How long a call to the server may take before the runner counts it as
  // unanswered. Above the server's tasks timeout, so the server answers
  // first.
  requestTimeoutMs: number;
  // How long the runner waits before it claims again, when there was no task
  // or no answer, and before it sends a completion again.
  pollMs: number;
  // go-task's binary: `task` on the PATH, or a path. Some distributions name
  // it go-task.
  taskBin: string;
  // How long a run may take before the runner stops it and it fails as
  // timeout.
  runTimeoutMs: number;
  // How long a stopped run has to exit after SIGTERM before SIGKILL, and how
  // long a run's output may stay open once go-task exited, stopped or not.
  killGraceMs: number;
  // Readable log lines instead of JSON.
  dev: boolean;
  // The lowest level the logger writes.
  logLevel: LogLevel;
}

// What the defaults depend on: main passes the machine's own.
export interface ConfigContext {
  // Called only when the name is the default.
  hostname: () => string;
}

// The runner's configuration, from the environment: each variable has a
// default, and apps/runner/.env.example lists them. Throws naming the
// variable on an invalid value.
export function loadConfig(
  env: Record<string, string | undefined>,
  { hostname }: ConfigContext,
): Config {
  const read = <T>(
    name: string,
    parse: (value: string, name: string) => T,
    fallback: () => T,
  ): T => {
    const value = env[name];
    return value === undefined ? fallback() : parse(value, name);
  };

  const name = read('SEXTOU_RUNNER_NAME', nonEmpty('a name'), hostname);
  return {
    serverUrl: read(
      'SEXTOU_RUNNER_SERVER_URL',
      parseUrl,
      () => 'http://127.0.0.1:4310',
    ),
    name,
    assignees: read('SEXTOU_RUNNER_ASSIGNEES', parseAssignees, () => [name]),
    requestTimeoutMs: read(
      'SEXTOU_RUNNER_REQUEST_TIMEOUT_MS',
      parseTimeout,
      () => 30000,
    ),
    pollMs: read('SEXTOU_RUNNER_POLL_MS', parseTimeout, () => 5000),
    taskBin: read(
      'SEXTOU_RUNNER_TASK_BIN',
      nonEmpty('a command or a path'),
      () => 'task',
    ),
    runTimeoutMs: read(
      'SEXTOU_RUNNER_RUN_TIMEOUT_MS',
      parseTimeout,
      () => 21600000,
    ),
    killGraceMs: read('SEXTOU_RUNNER_KILL_GRACE_MS', parseTimeout, () => 10000),
    dev: read('SEXTOU_RUNNER_DEV', parseBoolean, () => false),
    logLevel: read('SEXTOU_RUNNER_LOG_LEVEL', parseLogLevel, () => 'info'),
  };
}

function invalid(name: string, value: string, expected: string) {
  return new Error(
    `Invalid ${name}: ${JSON.stringify(value)} (expected ${expected})`,
  );
}

function parseUrl(value: string, name: string): string {
  const url = URL.parse(value);
  if (url?.protocol !== 'http:' && url?.protocol !== 'https:') {
    throw invalid(name, value, 'an http or https URL');
  }
  return url.href.replace(/\/+$/, '');
}

// The value trimmed, refused when nothing is left: a name, trimmed as the
// server trims the names it takes, or go-task's binary.
function nonEmpty(expected: string) {
  return (value: string, name: string): string => {
    const trimmed = value.trim();
    if (trimmed === '') {
      throw invalid(name, value, expected);
    }
    return trimmed;
  };
}

// Names separated by commas, each trimmed: at least one, none empty.
function parseAssignees(value: string, name: string): string[] {
  const names = value.split(',').map((part) => part.trim());
  if (names.includes('')) {
    throw invalid(name, value, 'names separated by commas');
  }
  return names;
}

// Up to the longest delay setTimeout takes: a longer one fires after 1 ms,
// which would claim or heartbeat nonstop.
function parseTimeout(value: string, name: string): number {
  const ms = Number(value);
  if (!/^\d+$/.test(value) || ms === 0 || ms > 2147483647) {
    throw invalid(
      name,
      value,
      'a whole number of milliseconds from 1 to 2147483647',
    );
  }
  return ms;
}

function parseBoolean(value: string, name: string): boolean {
  if (value !== 'true' && value !== 'false') {
    throw invalid(name, value, 'true or false');
  }
  return value === 'true';
}

function parseLogLevel(value: string, name: string): LogLevel {
  const level = logLevels.find((candidate) => candidate === value);
  if (level === undefined) {
    throw invalid(name, value, `one of ${logLevels.join(', ')}`);
  }
  return level;
}
