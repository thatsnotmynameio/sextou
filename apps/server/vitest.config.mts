import { defineConfig } from 'vitest/config';
import type { CoverageOptions } from 'vitest/node';

// The source files the integration suite answers for. The unit suite answers
// for every other one, so a new file belongs to it until it is listed here.
//
// No unit test answers for these, on purpose. database.ts takes ':memory:' or
// a path, and its in-memory cases alone don't reach the floor, so they sit in
// its integration test beside the cases on a file. server.ts listens on a
// port, and main.ts creates folders on disk and opens the database. The tasks
// module runs @sextou/tasks for real, two sextou packages together, even on
// ':memory:'.
export const integrationOnly = [
  'src/database.ts',
  'src/main.ts',
  'src/modules/tasks/index.ts',
  'src/modules/tasks/init.ts',
  'src/modules/tasks/service.ts',
  'src/server.ts',
];

// Each suite must reach this in every file it answers for, on its own.
export const coverage = {
  provider: 'v8',
  exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
  thresholds: {
    lines: 90,
    functions: 90,
    branches: 90,
    statements: 90,
    perFile: true,
  },
} satisfies CoverageOptions;

// The unit suite: *.test.ts in Node, with no disk or network: the router
// through createCaller, the app through app.request. The root
// vitest.config.ts runs it with the integration suite.
export default defineConfig({
  test: {
    name: 'server/unit',
    // This package's own module cache. Vitest otherwise keeps one at the
    // workspace root for every package, and each run clears it when the
    // lockfile changed: `pnpm -r` runs the packages at once, so one run's
    // clear fails on files another is writing (ENOTEMPTY).
    fsModuleCachePath: 'node_modules/.vitest-cache',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts'],
    coverage: {
      ...coverage,
      include: ['src/**/*.ts'],
      exclude: [...coverage.exclude, ...integrationOnly],
    },
  },
});
