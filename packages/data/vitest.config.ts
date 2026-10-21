import { defineConfig } from 'vitest/config';
import type { CoverageOptions } from 'vitest/node';

// The source files the integration suite answers for. The unit suite answers
// for every other one, so a new file belongs to it until it is listed here.
//
// No unit test answers for these, on purpose. migration-files.ts reads the
// migration folder from disk. database.ts takes ':memory:' or a path, and its
// in-memory cases alone don't reach the floor, so they sit in its integration
// test beside the cases on a file.
export const integrationOnly = ['src/database.ts', 'src/migration-files.ts'];
// Files both suites answer for, each reaching the floor in each.
export const alsoIntegration: string[] = [];

// Each suite must reach this in every file it answers for, on its own.
export const coverage = {
  provider: 'v8',
  exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/index.ts'],
  thresholds: {
    lines: 90,
    functions: 90,
    branches: 90,
    statements: 90,
    perFile: true,
  },
} satisfies CoverageOptions;

// The unit suite: *.test.ts in Node, on ':memory:', with no disk. The root
// vitest.config.ts runs it with the integration suite.
export default defineConfig({
  test: {
    name: 'data/unit',
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
