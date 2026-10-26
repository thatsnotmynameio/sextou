import { defineConfig } from 'vitest/config';

// The unit suite: tests/unit/ in Node, the logger writing to memory. The root
// vitest.config.ts runs it with the other packages' suites. Every source file
// must reach these thresholds.
export default defineConfig({
  test: {
    name: 'logger/unit',
    // This package's own module cache. Vitest otherwise keeps one at the
    // workspace root for every package, and each run clears it when the
    // lockfile changed: `pnpm -r` runs the packages at once, so one run's
    // clear fails on files another is writing (ENOTEMPTY).
    fsModuleCachePath: 'node_modules/.vitest-cache',
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
        perFile: true,
      },
    },
  },
});
