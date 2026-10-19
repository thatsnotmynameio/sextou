import { healthResponseSchema } from '@sextou/contract';
import type { Hono } from 'hono';
import { afterEach, expect, it, vi } from 'vitest';
import packageJson from '../package.json';
import { startServer } from './server';

vi.mock('./server', () => ({
  startServer: vi.fn(() =>
    Promise.resolve({
      host: '127.0.0.1',
      port: 54321,
      close: () => Promise.resolve(),
    }),
  ),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('starts the server from the arguments and prints where it listens', async () => {
  vi.stubEnv('SEXTOU_SERVER_HOST', undefined);
  vi.stubEnv('SEXTOU_SERVER_PORT', undefined);
  vi.spyOn(process, 'argv', 'get').mockReturnValue([
    'node',
    'main.ts',
    '--port',
    '0',
  ]);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  await import('./main');

  expect(startServer).toHaveBeenCalledOnce();
  const [app, config] = vi.mocked(startServer).mock.calls[0];
  expect(config).toEqual({ host: '127.0.0.1', port: 0 });
  // The app reports the package's version, and an uptime counted from the
  // start just now.
  const response = await (app as Hono).request('/health');
  expect(healthResponseSchema.parse(await response.json())).toEqual({
    version: packageJson.version,
    uptimeSeconds: 0,
  });
  expect(log).toHaveBeenCalledWith('listening on http://127.0.0.1:54321');
});
