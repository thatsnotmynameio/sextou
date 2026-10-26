import { afterEach, expect, test } from 'vitest';
import { createApp } from '../../src/app';
import { createLogger } from '@sextou/logger';
import { startServer, type RunningServer } from '../../src/server';
import { fakeTasks } from '../tasks';

const app = createApp({
  version: '1.2.3',
  database: { ping: async () => true },
  dev: false,
  logger: createLogger({ level: 'silent', pretty: false }),
  tasks: fakeTasks(),
  webOrigin: 'http://localhost:5173',
});

const running: RunningServer[] = [];

async function start(port = 0) {
  const server = await startServer(app, { host: '127.0.0.1', port });
  running.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});

test('startServer resolves with the port the system picked for port 0', async () => {
  const server = await start();
  expect(server.host).toBe('127.0.0.1');
  expect(server.port).toBeGreaterThan(0);
});

test('startServer serves the app over HTTP', async () => {
  const { port } = await start();
  const response = await fetch(`http://127.0.0.1:${port}/trpc/health.check`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    result: { data: { version: '1.2.3', database: 'up' } },
  });
});

test('startServer stops accepting connections once closed', async () => {
  const server = await startServer(app, { host: '127.0.0.1', port: 0 });
  await server.close();
  await expect(
    fetch(`http://127.0.0.1:${server.port}/trpc/health.check`),
  ).rejects.toThrow();
});

test('startServer rejects when the port is already in use', async () => {
  const { port } = await start();
  await expect(
    startServer(app, { host: '127.0.0.1', port }),
  ).rejects.toMatchObject({ code: 'EADDRINUSE' });
});
