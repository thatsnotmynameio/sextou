import { defineConfig } from 'vitest/config';
import type { CoverageOptions } from 'vitest/node';

// The source files the integration suite answers for. The unit suite answers
// for every other one, so a new file belongs to it until it is listed here.
//
// No unit test answers for these, on purpose: main.ts runs the runner against
// the server, which its test starts as a child process, taskfile.ts runs
// go-task as one, and download.ts runs tar as one, on what an HTTP server on
// localhost serves.
export const integrationOnly = [
  'src/main.ts',
  'src/taskfile.ts',
  'src/download.ts',
];

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

// The unit suite: tests/unit/ in Node, with no disk or network: the client
// over a stubbed fetch, the loop over a fake client and fake timers. The root
// vitest.config.ts runs it with the integration suite.
export default defineConfig({
  test: {
    name: 'runner/unit',
    // This package's own module cache, as the server's vitest.config explains.
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
