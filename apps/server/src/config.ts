import path from 'node:path';
import { defaultDataDirectory } from './data-directory';

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
  host: string;
  port: number;
  // An absolute file path, or ':memory:'.
  database: string;
  // The web app's origin, the one CORS lets call the server.
  webOrigin: string;
  // How long a database query may take before the server counts the
  // database as down. Below the web app's request timeout, so a database
  // that hangs shows as down rather than as a server that can't be reached.
  databaseTimeoutMs: number;
  // Whether error responses carry the stack.
  dev: boolean;
  // The lowest level the logger writes.
  logLevel: LogLevel;
}

// What the paths depend on: main passes the process's own.
export interface PathContext {
  platform: NodeJS.Platform;
  // Called only when the default data directory is needed.
  homedir: () => string;
  // The directory a relative path is resolved against.
  cwd: string;
}

// The server's configuration, from the environment: each variable has a
// default, and apps/server/.env.example lists them. Throws naming the
// variable on an invalid value.
export function loadConfig(
  env: Record<string, string | undefined>,
  { platform, homedir, cwd }: PathContext,
): Config {
  const read = <T>(
    name: string,
    parse: (value: string, name: string) => T,
    fallback: () => T,
  ): T => {
    const value = env[name];
    return value === undefined ? fallback() : parse(value, name);
  };

  return {
    // Loopback by default: there is no authentication yet.
    host: read('SEXTOU_SERVER_HOST', parseHost, () => '127.0.0.1'),
    port: read('SEXTOU_SERVER_PORT', parsePort, () => 4310),
    database: read(
      'SEXTOU_SERVER_DATABASE',
      (value, name) => parseDatabase(value, name, cwd),
      () =>
        path.join(
          read(
            'SEXTOU_SERVER_DATA_DIR',
            (value, name) => parseDataDir(value, name, cwd),
            () => defaultDataDirectory(platform, env, homedir()),
          ),
          'sextou.db',
        ),
    ),
    webOrigin: read(
      'SEXTOU_SERVER_WEB_ORIGIN',
      parseOrigin,
      () => 'http://localhost:5173',
    ),
    databaseTimeoutMs: read(
      'SEXTOU_SERVER_DATABASE_TIMEOUT_MS',
      parseTimeout,
      () => 20000,
    ),
    dev: read('SEXTOU_SERVER_DEV', parseBoolean, () => false),
    logLevel: read('SEXTOU_SERVER_LOG_LEVEL', parseLogLevel, () => 'info'),
  };
}

function invalid(name: string, value: string, expected: string) {
  return new Error(
    `Invalid ${name}: ${JSON.stringify(value)} (expected ${expected})`,
  );
}

// Node binds an empty host to every interface: an empty value is an error,
// not a way to reach the server from the network.
function parseHost(value: string, name: string): string {
  if (value === '') {
    throw invalid(name, value, 'a host name or address');
  }
  return value;
}

// Only digits, from 0 to 65535. 0 lets the system pick a free port.
function parsePort(value: string, name: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || port > 65535) {
    throw invalid(name, value, 'a port from 0 to 65535');
  }
  return port;
}

// An empty value would put the data in the working directory. A relative
// path is made absolute, so the data doesn't move with the directory the
// server starts from.
function parseDataDir(value: string, name: string, cwd: string): string {
  if (value === '') {
    throw invalid(name, value, 'a folder path');
  }
  return path.resolve(cwd, value);
}

// SQLite opens an empty path as a temporary database it deletes on close, so
// an empty value is an error. A relative path is made absolute, as above.
function parseDatabase(value: string, name: string, cwd: string): string {
  if (value === '') {
    throw invalid(name, value, 'a file path or :memory:');
  }
  return value === ':memory:' ? value : path.resolve(cwd, value);
}

// Only the origin: the browser sends it with no path, and CORS compares it
// as a string.
function parseOrigin(value: string, name: string): string {
  const url = URL.parse(value);
  if (url?.protocol !== 'http:' && url?.protocol !== 'https:') {
    throw invalid(name, value, 'an http or https URL');
  }
  return url.origin;
}

// Only digits, from 1 millisecond to the longest delay setTimeout takes: a
// longer one fires after 1 ms, which would report the database down.
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
