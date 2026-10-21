import { defineConfig } from 'vitest/config';
import type { CoverageOptions } from 'vitest/node';

// The source files the integration suite answers for. The unit suite answers
// for every other one, so a new file belongs to it until it is listed here.
//
// No unit test answers for these, on purpose: each reaches another sextou
// package for real (@sextou/core, @sextou/data or @sextou/tasks), the disk or
// a listening server, so the unit suite answers only for config.ts and
// data-directory.ts.
export const integrationOnly = [
  'src/app.ts',
  'src/main.ts',
  'src/modules/health/health.routes.ts',
  'src/server.ts',
];
// Files both suites answer for, each reaching the floor in each.
export const alsoIntegration: string[] = [];

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

// The unit suite: *.test.ts in Node, with no other sextou package, disk or
// network. The root vitest.config.ts runs it with the integration suite.
export default defineConfig({
  test: {
    name: 'server/unit',
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
