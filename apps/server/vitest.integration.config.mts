import { defineConfig } from 'vitest/config';
import { coverage, integrationOnly } from './vitest.config.mjs';

// The integration suite: tests/integration/ in Node, with databases and
// files in a temporary directory and servers on localhost. It answers only
// for the files vitest.config.mts lists.
export default defineConfig({
  test: {
    name: 'server/integration',
    // This package's own module cache, as vitest.config's comment explains.
    fsModuleCachePath: 'node_modules/.vitest-cache',
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    coverage: {
      ...coverage,
      include: integrationOnly,
    },
  },
});
