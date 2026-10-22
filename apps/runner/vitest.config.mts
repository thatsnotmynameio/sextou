import { defineConfig } from 'vitest/config';
import type { CoverageOptions } from 'vitest/node';

// The source files the integration suite answers for. The unit suite answers
// for every other one, so a new file belongs to it until it is listed here.
// None today: the unit suite reaches every file with fetch stubbed, and the
// integration suite only proves the loop against the real server.
export const integrationOnly: string[] = [];

// Each suite must reach this in every file it answers for, on its own.
export const coverage = {
  provider: 'v8',
  exclude: ['src/**/*.d.ts'],
  thresholds: {
    lines: 90,
    functions: 90,
    branches: 90,
    statements: 90,
    perFile: true,
  },
} satisfies CoverageOptions;

// The unit suite: tests/unit/ in Node, with no disk or network: fetch is
// stubbed. The root vitest.config.ts runs it with the integration suite.
export default defineConfig({
  test: {
    name: 'runner/unit',
    // This package's own module cache. Vitest otherwise keeps one at the
    // workspace root for every package, and each run clears it when the
    // lockfile changed: `pnpm -r` runs the packages at once, so one run's
    // clear fails on files another is writing (ENOTEMPTY).
    fsModuleCachePath: 'node_modules/.vitest-cache',
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      ...coverage,
      include: ['src/**/*.ts'],
      exclude: [...coverage.exclude, ...integrationOnly],
    },
  },
});
