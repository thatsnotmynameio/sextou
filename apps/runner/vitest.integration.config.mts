import { defineConfig } from 'vitest/config';
import { coverage, integrationOnly } from './vitest.config.mjs';

// The integration suite: tests/integration/ in Node, against the server
// started as a child process on localhost. It answers only for the files
// vitest.config.mts lists.
export default defineConfig({
  test: {
    name: 'runner/integration',
    // This package's own module cache, as vitest.config's comment explains.
    fsModuleCachePath: 'node_modules/.vitest-cache',
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    // The server takes a few seconds to start from its sources, most of
    // them loading Turso's native addon.
    testTimeout: 30_000,
    coverage: {
      ...coverage,
      include: integrationOnly,
    },
  },
});
