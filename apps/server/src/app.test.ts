import { expect, test } from 'vitest';
import { createApp, type AppOptions } from './app';

const webOrigin = 'http://localhost:5173';

function app(options: Partial<AppOptions> = {}) {
  return createApp({
    version: '1.2.3',
    database: { ping: async () => true },
    dev: false,
    webOrigin,
    ...options,
  });
}

test('the app answers GET /trpc/health.check in tRPC’s response shape', async () => {
  const response = await app().request('/trpc/health.check');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    result: { data: { version: '1.2.3', database: 'up' } },
  });
});

test('the app answers a batched GET, as the web app’s client sends it', async () => {
  const response = await app().request(
    '/trpc/health.check?batch=1&input=%7B%7D',
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([
    { result: { data: { version: '1.2.3', database: 'up' } } },
  ]);
});

test('the app answers an unknown path under /trpc with NOT_FOUND', async () => {
  const response = await app().request('/trpc/nothing');

  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({
    error: { data: { code: 'NOT_FOUND' } },
  });
});

test('the app lets the web app’s origin through a preflight', async () => {
  const response = await app().request('/trpc/health.check', {
    method: 'OPTIONS',
    headers: {
      origin: webOrigin,
      'access-control-request-method': 'GET',
    },
  });

  expect(response.status).toBe(204);
  expect(response.headers.get('access-control-allow-origin')).toBe(webOrigin);
});

test('the app gives the web app’s origin the answer to a request', async () => {
  const response = await app().request('/trpc/health.check', {
    headers: { origin: webOrigin },
  });

  expect(response.headers.get('access-control-allow-origin')).toBe(webOrigin);
});

test('the app lets no other origin read its answers', async () => {
  const response = await app().request('/trpc/health.check', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://elsewhere.example',
      'access-control-request-method': 'GET',
    },
  });

  expect(response.headers.get('access-control-allow-origin')).toBeNull();
});

test('an error response carries the stack in development', async () => {
  const response = await app({ version: '', dev: true }).request(
    '/trpc/health.check',
  );

  expect(response.status).toBe(500);
  const { error } = await response.json();
  expect(error.data.code).toBe('INTERNAL_SERVER_ERROR');
  expect(error.data.stack).toContain('Output validation failed');
});

test('an error response carries no stack outside development', async () => {
  const response = await app({ version: '' }).request('/trpc/health.check');

  expect(response.status).toBe(500);
  const { error } = await response.json();
  expect(error.data.code).toBe('INTERNAL_SERVER_ERROR');
  expect(error.data).not.toHaveProperty('stack');
});
