import { defineConfig } from 'vitest/config';
import type { CoverageOptions } from 'vitest/node';

// The source files the integration suite answers for. The unit suite answers
// for every other one, so a new file belongs to it until it is listed here.
//
// No unit test answers for these, on purpose. owner-only.ts sets the modes of
// files on disk. Opening the graph reads its migrations from disk, even for
// ':memory:', so every test of open-tasks.ts and graph.ts is an integration
// test.
export const integrationOnly = [
  'src/graph.ts',
  'src/open-tasks.ts',
  'src/owner-only.ts',
];

// Each suite must reach this in every file it answers for, on its own.
// schema.ts answers to neither: only drizzle-kit runs its checks, indexes and
// foreign keys, in a process coverage doesn't see, and the drift test in
// schema.integration.test.ts guards them. stryker.config.mjs leaves it out
// too.
export const coverage = {
  provider: 'v8',
  exclude: [
    'src/**/*.test.ts',
    'src/**/*.d.ts',
    'src/index.ts',
    'src/schema.ts',
  ],
  thresholds: {
    lines: 90,
    functions: 90,
    branches: 90,
    statements: 90,
    perFile: true,
  },
} satisfies CoverageOptions;

// The unit suite: *.test.ts in Node, with no disk. The root
// vitest.config.ts runs it with the integration suite.
export default defineConfig({
  test: {
    name: 'tasks/unit',
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
