import { defineConfig } from 'vitest/config';

// The unit suite: the main process's pure modules, in Node. main.ts imports
// Electron and is checked by running the app instead. CI runs this suite
// through the root vitest.config.ts. Every source file must reach these
// thresholds.
export default defineConfig({
  test: {
    name: 'desktop/unit',
    // This package's own module cache. Vitest otherwise keeps one at the
    // workspace root for every package, and each run clears it when the
    // lockfile changed: `pnpm -r` runs the packages at once, so one run's
    // clear fails on files another is writing (ENOTEMPTY).
    fsModuleCachePath: 'node_modules/.vitest-cache',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/main/main.ts'],
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
