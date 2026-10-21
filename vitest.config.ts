// CI runs `vitest run` at the repository root: this points it at each
// package's unit suite, with that package's own configuration.
export default {
  test: {
    projects: [
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
