import { defineConfig } from 'vitest/config';
import { coverage, integrationOnly } from './vitest.config';

// The integration suite: tests/integration/ in Node, running git against a
// git server on localhost, and go-task on the Taskfiles. It answers only for
// the files vitest.config.ts lists.
export default defineConfig({
  test: {
    name: 'workflows/integration',
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
