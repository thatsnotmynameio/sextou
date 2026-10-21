import { defineConfig } from 'vitest/config';

// Stryker's run: the unit and the integration suites together, so a mutant
// either one kills counts. The name keeps it out of the root's lookup of
// vitest.config.*, and it sets no coverage: each suite's own run judges that.
export default defineConfig({
  test: {
    projects: ['./vitest.config.ts', './vitest.integration.config.ts'],
  },
});
