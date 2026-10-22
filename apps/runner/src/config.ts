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
  // The server's URL, with no trailing slash.
  serverUrl: string;
  // How long the runner waits after each request before the next one.
  pollIntervalMs: number;
  // How long a request may wait for the server. Above the server's own
  // timeouts, so the server answers before the runner gives up.
  requestTimeoutMs: number;
  // Readable log lines instead of JSON.
  dev: boolean;
  // The lowest level the logger writes.
  logLevel: LogLevel;
}

// The runner's configuration, from the environment: each variable has a
// default, and apps/runner/.env.example lists them. Throws naming the
// variable on an invalid value.
export function loadConfig(env: Record<string, string | undefined>): Config {
  const read = <T>(
    name: string,
    parse: (value: string, name: string) => T,
    fallback: T,
  ): T => {
    const value = env[name];
    return value === undefined ? fallback : parse(value, name);
  };

  return {
    serverUrl: read(
      'SEXTOU_RUNNER_SERVER_URL',
      parseUrl,
      'http://127.0.0.1:4310',
    ),
    pollIntervalMs: read('SEXTOU_RUNNER_POLL_INTERVAL_MS', parseMs, 1000),
    requestTimeoutMs: read('SEXTOU_RUNNER_REQUEST_TIMEOUT_MS', parseMs, 30000),
    dev: read('SEXTOU_RUNNER_DEV', parseBoolean, false),
    logLevel: read('SEXTOU_RUNNER_LOG_LEVEL', parseLogLevel, 'info'),
  };
}

function invalid(name: string, value: string, expected: string) {
  return new Error(
    `Invalid ${name}: ${JSON.stringify(value)} (expected ${expected})`,
  );
}

// The client appends /trpc to it, so a trailing slash would double it.
function parseUrl(value: string, name: string): string {
  const url = URL.parse(value);
  if (url?.protocol !== 'http:' && url?.protocol !== 'https:') {
    throw invalid(name, value, 'an http or https URL');
  }
  return url.href.replace(/\/+$/, '');
}

// Only digits, from 1 millisecond to the longest delay setTimeout takes: a
// longer one fires after 1 ms.
function parseMs(value: string, name: string): number {
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
