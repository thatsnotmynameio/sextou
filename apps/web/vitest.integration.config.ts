import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';
import { coverage, integrationOnly } from './vitest.config';

// The integration suite: *.integration.test.tsx in jsdom, against the server
// started as a child process on localhost. It answers only for the files
// vitest.config.ts lists.
export default mergeConfig(
  viteConfig({ mode: 'test', command: 'serve' }),
  defineConfig({
    test: {
      name: 'web/integration',
      environment: 'jsdom',
      include: ['src/**/*.integration.test.{ts,tsx}'],
      setupFiles: ['./vitest.setup.ts'],
      // The server takes a few seconds to start from its sources, most of
      // them loading Turso's native addon.
      testTimeout: 30_000,
      coverage: {
        ...coverage,
        include: integrationOnly,
      },
    },
  }),
);
