import { defineConfig } from 'vitest/config';

// Stryker's run: the unit and the integration suites together, so a mutant
// either one kills counts. The name keeps it out of the root's lookup of
// vitest.config.*, and it sets no coverage: each suite's own run judges that.
export default defineConfig({
  test: {
    // This package's own module cache, as vitest.config's comment explains.
    fsModuleCachePath: 'node_modules/.vitest-cache',
    projects: ['./vitest.config.mts', './vitest.integration.config.mts'],
  },
});
