// CI runs `vitest run` at the repository root: this points it at each
// package's unit and integration suites, with that package's own
// configuration. The component suite needs a browser and runs on its own.
// This config sets no coverage, so a run filtered to a module's path never
// fails on the files it leaves out.
export default {
  test: {
    projects: [
      '.github/scripts',
      '.github/scripts/vitest.integration.config.ts',
      'apps/desktop',
      'apps/server',
      'apps/server/vitest.integration.config.mts',
      'apps/web',
      'packages/contract',
      'packages/core',
      'packages/data',
      'packages/data/vitest.integration.config.ts',
      'packages/tasks',
      'packages/tasks/vitest.integration.config.ts',
      'packages/ui',
    ],
  },
};
