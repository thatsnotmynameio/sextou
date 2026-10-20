import { defineConfig } from 'vitest/config';

// The unit suite: *.test.ts in Node. CI runs it through the root
// vitest.config.ts. Every source file must reach these thresholds. The fakes
// in src/test/ run only as child processes, which coverage doesn't see.
export default defineConfig({
  test: {
    name: 'beads',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/index.ts',
        'src/test/**',
      ],
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
