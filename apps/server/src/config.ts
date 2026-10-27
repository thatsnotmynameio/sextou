import path from 'node:path';
import {
  invalid,
  parseBoolean,
  parseCount,
  parseOneOf,
  parseTimeout,
  reader,
} from '@sextou/config';
import { logLevels, type LogLevel } from '@sextou/logger/levels';
import { defaultDataDirectory } from './data-directory';

export interface Config {
  host: string;
  port: number;
  // An absolute file path, or ':memory:'.
  database: string;
  // The tasks database's file: an absolute path, or ':memory:'.
  tasksDb: string;
  // The web app's origin, the one CORS lets call the server.
  webOrigin: string;
  // How long a database query may take before the server counts the
  // database as down. Below the web app's request timeout, so a database
  // that hangs shows as down rather than as a server that can't be reached.
  databaseTimeoutMs: number;
  // How long a call to the tasks database may take: one past it writes
  // nothing. Below the web app's request timeout, as databaseTimeoutMs.
  tasksTimeoutMs: number;
  // How long a runner's lease on a task lasts unless renewed.
  leaseMs: number;
  // How many attempts a task gets before an expired lease fails it: 1 fails
  // it at the first.
  maxAttempts: number;
  // How many tasks one run's tasks file may create: a file with more fails
  // its task and creates none.
  maxCreatedTasks: number;
  // How deep a task a run's tasks file creates may sit, its depth being the
  // number of parents above it: a file whose tasks would sit deeper fails its
  // task and creates none.
  maxTaskDepth: number;
  // How often the server ends the attempts whose lease expired.
  leaseSweepMs: number;
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
  // The data directory when none is configured; unset, the user's data
  // directory for the platform.
  storage?: string;
}

// The server's configuration, from the environment: each variable has a
// default, and apps/server/.env.example lists them. Throws naming the
// variable on an invalid value.
export function loadConfig(
  env: Record<string, string | undefined>,
  { platform, homedir, cwd, storage }: PathContext,
): Config {
  const read = reader(env);

  // A file in the data directory, which is read only when a default needs
  // it, and at most once.
  let dataDirectory: string | undefined;
  const inDataDirectory = (file: string) => {
    dataDirectory ??= read(
      'SEXTOU_SERVER_DATA_DIR',
      (value, name) => parseDataDir(value, name, cwd),
      () => storage ?? defaultDataDirectory(platform, env, homedir()),
    );
    return path.join(dataDirectory, file);
  };

  return {
    // Loopback by default: there is no authentication yet.
    host: read('SEXTOU_SERVER_HOST', parseHost, () => '127.0.0.1'),
    port: read('SEXTOU_SERVER_PORT', parsePort, () => 4310),
    database: read(
      'SEXTOU_SERVER_DATABASE',
      (value, name) => parseDatabase(value, name, cwd),
      () => inDataDirectory('sextou.db'),
    ),
    tasksDb: read(
      'SEXTOU_SERVER_TASKS_DB',
      (value, name) => parseDatabase(value, name, cwd),
      () => inDataDirectory('tasks.db'),
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
    tasksTimeoutMs: read(
      'SEXTOU_SERVER_TASKS_TIMEOUT_MS',
      parseTimeout,
      () => 20000,
    ),
    leaseMs: read('SEXTOU_SERVER_LEASE_MS', parseTimeout, () => 30000),
    maxAttempts: read('SEXTOU_SERVER_MAX_ATTEMPTS', parseAttempts, () => 1),
    maxCreatedTasks: read(
      'SEXTOU_SERVER_MAX_CREATED_TASKS',
      parseCreatedTasks,
      () => 50,
    ),
    // Room for a template that chains runs, each creating the next batch.
    maxTaskDepth: read('SEXTOU_SERVER_MAX_TASK_DEPTH', parseDepth, () => 20),
    leaseSweepMs: read(
      'SEXTOU_SERVER_LEASE_SWEEP_MS',
      parseTimeout,
      () => 5000,
    ),
    dev: read('SEXTOU_SERVER_DEV', parseBoolean, () => false),
    logLevel: read(
      'SEXTOU_SERVER_LOG_LEVEL',
      parseOneOf(logLevels),
      () => 'info',
    ),
  };
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

// A database file: the server's, or the tasks database. SQLite opens an empty
// path as a temporary database it deletes on close, so an empty value is an
// error. A relative path is made absolute, as above.
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

function parseAttempts(value: string, name: string): number {
  return parseCount(
    value,
    name,
    Number.MAX_SAFE_INTEGER,
    'a whole number of attempts from 1',
  );
}

function parseCreatedTasks(value: string, name: string): number {
  return parseCount(
    value,
    name,
    Number.MAX_SAFE_INTEGER,
    'a whole number of tasks from 1',
  );
}

function parseDepth(value: string, name: string): number {
  return parseCount(
    value,
    name,
    Number.MAX_SAFE_INTEGER,
    'a whole number of levels from 1',
  );
}
