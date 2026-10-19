import path from 'node:path';
import { parseArgs } from 'node:util';
import { defaultDatabasePath } from './database-path';

export interface Config {
  host: string;
  port: number;
  // An absolute file path, or ':memory:'.
  database: string;
}

// What the database path depends on: main passes the process's own.
export interface PathContext {
  platform: NodeJS.Platform;
  // Called only when the default database path is needed.
  homedir: () => string;
  // The directory a relative database path is resolved against.
  cwd: string;
}

// Loopback by default: there is no authentication yet, so reaching the server
// from the network takes an explicit --host.
const defaults = { host: '127.0.0.1', port: 4310 };

// The server's configuration, from the environment and the command line
// arguments (without node and the script); an argument wins over its
// variable. Throws on an unknown flag or an invalid value.
export function loadConfig(
  env: Record<string, string | undefined>,
  args: string[],
  { platform, homedir, cwd }: PathContext,
): Config {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      host: { type: 'string' },
      port: { type: 'string' },
      database: { type: 'string' },
    },
  });

  const port =
    values.port !== undefined
      ? parsePort(values.port, '--port')
      : env.SEXTOU_SERVER_PORT !== undefined
        ? parsePort(env.SEXTOU_SERVER_PORT, 'SEXTOU_SERVER_PORT')
        : defaults.port;

  const host =
    values.host !== undefined
      ? parseHost(values.host, '--host')
      : env.SEXTOU_SERVER_HOST !== undefined
        ? parseHost(env.SEXTOU_SERVER_HOST, 'SEXTOU_SERVER_HOST')
        : defaults.host;

  const database =
    values.database !== undefined
      ? parseDatabase(values.database, '--database', cwd)
      : env.SEXTOU_SERVER_DATABASE !== undefined
        ? parseDatabase(
            env.SEXTOU_SERVER_DATABASE,
            'SEXTOU_SERVER_DATABASE',
            cwd,
          )
        : defaultDatabasePath(platform, env, homedir());

  return { host, port, database };
}

// Node binds an empty host to every interface: an empty value is an error,
// not a way to reach the server from the network.
function parseHost(value: string, source: string): string {
  if (value === '') {
    throw new Error(`Invalid ${source}: "" (expected a host name or address)`);
  }
  return value;
}

// Only digits, from 0 to 65535. 0 lets the system pick a free port.
function parsePort(value: string, source: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || port > 65535) {
    throw new Error(
      `Invalid ${source}: ${JSON.stringify(value)} (expected a port from 0 to 65535)`,
    );
  }
  return port;
}

// SQLite opens an empty path as a temporary database it deletes on close, so
// an empty value is an error. A relative path is made absolute, so the file
// doesn't move with the directory the server starts from.
function parseDatabase(value: string, source: string, cwd: string): string {
  if (value === '') {
    throw new Error(`Invalid ${source}: "" (expected a file path or :memory:)`);
  }
  return value === ':memory:' ? value : path.resolve(cwd, value);
}
