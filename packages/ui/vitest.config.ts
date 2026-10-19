import { defineConfig, mergeConfig } from 'vitest/config';
import type { CoverageOptions } from 'vitest/node';
import viteConfig from './vite.config';

// Each suite must reach this in every source file, on its own.
export const coverage: CoverageOptions = {
  provider: 'v8',
  include: ['src/**/*.{ts,tsx}'],
  exclude: [
    'src/**/*.stories.tsx',
    'src/**/*.test.tsx',
    'src/test/**',
    'src/**/*.d.ts',
    'src/index.ts',
  ],
  thresholds: {
    lines: 90,
    functions: 90,
    branches: 90,
    statements: 90,
    perFile: true,
  },
};

// The unit suite: *.test.tsx in jsdom, no browser. CI runs it through the
// root vitest.config.ts. The stories run in vitest.integration.config.ts.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      name: 'unit',
      environment: 'jsdom',
      include: ['src/**/*.test.tsx'],
      setupFiles: ['./vitest.setup.ts'],
      coverage,
    },
  }),
);
