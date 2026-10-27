import { defineConfig } from 'vitest/config';
import { coverage, integrationOnly } from './vitest.config.mjs';

// The integration suite: tests/integration/ in Node, against the server
// tests/server.ts starts as a child process on localhost, and go-task run as
// one. It answers only for the files vitest.config.mts lists.
export default defineConfig({
  test: {
    name: 'runner/integration',
    // This package's own module cache, as vitest.config's comment explains.
    fsModuleCachePath: 'node_modules/.vitest-cache',
    environment: 'node',
    globalSetup: ['tests/server.ts'],
    include: ['tests/integration/**/*.test.ts'],
    coverage: {
      ...coverage,
      include: integrationOnly,
    },
  },
});
