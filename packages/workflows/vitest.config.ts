import { defineConfig } from 'vitest/config';
import type { CoverageOptions } from 'vitest/node';

// The source files the integration suite answers for. The unit suite answers
// for every other one, so a new file belongs to it until it is listed here.
//
// No unit test answers for these, on purpose: git/checkout/checkout.ts runs
// git as a child process, against a git server on localhost;
// harness/claude-headless/headless.ts runs claude as one, a fake the test
// writes to disk; shared/run.ts runs both, and shared/workspace.ts reads
// folders on disk, through both.
export const integrationOnly = [
  'git/checkout/checkout.ts',
  'harness/claude-headless/headless.ts',
  'shared/run.ts',
  'shared/workspace.ts',
];

// Each suite must reach this in every file it answers for, on its own: the
// scripts the Taskfiles run, every .ts file beside a Taskfile. A script's
// main.ts only calls its module with the process's environment and sets the
// exit code; the Taskfile tests run it, in a process of its own that coverage
// doesn't see. stryker.config.mjs leaves it out too.
export const coverage = {
  provider: 'v8',
  exclude: ['tests/**', '*.config.ts', '**/main.ts'],
  thresholds: {
    lines: 90,
    functions: 90,
    branches: 90,
    statements: 90,
    perFile: true,
  },
} satisfies CoverageOptions;

// The unit suite: tests/unit/ in Node, with no disk. The root vitest.config.ts
// runs it with the integration suite.
export default defineConfig({
  test: {
    name: 'workflows/unit',
    // This package's own module cache. Vitest otherwise keeps one at the
    // workspace root for every package, and each run clears it when the
    // lockfile changed: `pnpm -r` runs the packages at once, so one run's
    // clear fails on files another is writing (ENOTEMPTY).
    fsModuleCachePath: 'node_modules/.vitest-cache',
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      ...coverage,
      include: ['**/*.ts'],
      exclude: [...coverage.exclude, ...integrationOnly],
    },
  },
});
