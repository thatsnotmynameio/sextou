import { parseArgs } from 'node:util';

export interface Config {
  host: string;
  port: number;
}

// Loopback by default: there is no authentication yet, so reaching the server
// from the network takes an explicit --host.
const defaults: Config = { host: '127.0.0.1', port: 4310 };

// The server's configuration, from the environment and the command line
// arguments (without node and the script); an argument wins over its
// variable. Throws on an unknown flag or an invalid port.
export function loadConfig(
  env: Record<string, string | undefined>,
  args: string[],
): Config {
  const { values } = parseArgs({
    args,
    strict: true,
    options: { host: { type: 'string' }, port: { type: 'string' } },
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

  return { host, port };
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
