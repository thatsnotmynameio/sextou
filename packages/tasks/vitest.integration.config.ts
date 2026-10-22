import { defineConfig } from 'vitest/config';
import { coverage, integrationOnly } from './vitest.config';

// The integration suite: tests/integration/ in Node, on files in a
// temporary directory. It answers only for the files vitest.config.ts lists.
export default defineConfig({
  test: {
    name: 'tasks/integration',
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
