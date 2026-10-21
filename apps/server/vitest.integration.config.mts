import { defineConfig } from 'vitest/config';
import { coverage, integrationOnly } from './vitest.config.mjs';

// The integration suite: *.integration.test.ts in Node, with databases and
// files in a temporary directory and servers on localhost. It answers only
// for the files vitest.config.mts lists.
export default defineConfig({
  test: {
    name: 'server/integration',
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    coverage: {
      ...coverage,
      include: integrationOnly,
    },
  },
});
