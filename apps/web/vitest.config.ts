import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// The unit suite: *.test.ts(x) in jsdom, no browser. CI runs it through the
// root vitest.config.ts. Every source file must reach these thresholds.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      name: 'web',
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./vitest.setup.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', 'src/main.tsx'],
        thresholds: {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
          perFile: true,
        },
      },
    },
  }),
);
