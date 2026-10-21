import { defineConfig } from 'vitest/config';

// Stryker's run: the unit and the integration suites together, so a mutant
// either one kills counts. The name keeps it out of the root's lookup of
// vitest.config.*, and it sets no coverage: each suite's own run judges that.
// The registry test stays out: it kills no mutant, and it reads the whole
// repository, which Stryker's sandbox doesn't hold.
export default defineConfig({
  test: {
    projects: [
      './vitest.config.ts',
      {
        extends: './vitest.integration.config.ts',
        test: { exclude: ['src/registry.integration.test.ts'] },
      },
    ],
  },
});
