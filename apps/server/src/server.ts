import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import type { Config } from './config';

export interface RunningServer {
  // The address the server is bound to: the system's pick for port 0.
  host: string;
  port: number;
  close(): Promise<void>;
}

// Serves the app on the configured host and port. Resolves once listening;
// rejects when listening fails, as on a port already in use.
export function startServer(
  app: Hono,
  { host, port }: Pick<Config, 'host' | 'port'>,
): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
      server.off('error', reject);
      resolve({
        host: info.address,
        port: info.port,
        // close only fails on a server that isn't running: already closed.
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
    server.once('error', reject);
  });
}
