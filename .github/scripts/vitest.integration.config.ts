import { defineConfig } from 'vitest/config';
import { alsoIntegration, coverage, integrationOnly } from './vitest.config';

// The integration suite: *.integration.test.ts in Node, on reports in a
// temporary directory. It answers only for the files vitest.config.ts lists.
export default defineConfig({
  test: {
    name: 'scripts/integration',
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    coverage: {
      ...coverage,
      include: [...integrationOnly, ...alsoIntegration],
    },
  },
});
