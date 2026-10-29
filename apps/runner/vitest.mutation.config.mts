import { defineConfig } from 'vitest/config';

// Stryker's run: the unit and the integration suites together, so a mutant
// either one kills counts. The name keeps it out of the root's lookup of
// vitest.config.*, and it sets no coverage: each suite's own run judges that.
// fast-check runs on a fixed seed and stops at the first failure here, and
// the context's properties, each run a download and a go-task, run fewer.
const setupFiles = ['./tests/fast-check.mutation.ts'];

export default defineConfig({
  test: {
    // This package's own module cache, as vitest.config's comment explains.
    fsModuleCachePath: 'node_modules/.vitest-cache',
    projects: [
      { extends: './vitest.config.mts', test: { setupFiles } },
      {
        extends: './vitest.integration.config.mts',
        test: { setupFiles, env: { CONTEXT_PROPERTY_RUNS: '5' } },
      },
    ],
  },
});
