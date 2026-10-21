import { healthResponseSchema } from '@sextou/contract';
import { afterEach, expect, test } from 'vitest';
import { createApp } from './app';
import { startServer, type RunningServer } from './server';

const app = createApp({
  version: '1.2.3',
  startedAt: new Date(),
  now: () => new Date(),
  pingDatabase: async () => true,
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
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  expect(response.status).toBe(200);
  expect(healthResponseSchema.parse(await response.json()).version).toBe(
    '1.2.3',
  );
});

test('startServer stops accepting connections once closed', async () => {
  const server = await startServer(app, { host: '127.0.0.1', port: 0 });
  await server.close();
  await expect(
    fetch(`http://127.0.0.1:${server.port}/health`),
  ).rejects.toThrow();
});

test('startServer rejects when the port is already in use', async () => {
  const { port } = await start();
  await expect(
    startServer(app, { host: '127.0.0.1', port }),
  ).rejects.toMatchObject({ code: 'EADDRINUSE' });
});
