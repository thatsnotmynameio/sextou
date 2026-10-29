import { defineConfig, mergeConfig } from 'vitest/config';
import unit from './vitest.config';

// Stryker's run: the unit suite, with fast-check on a fixed seed that stops
// at the first failure. The name keeps it out of the root's lookup of
// vitest.config.*.
export default mergeConfig(
  unit,
  defineConfig({
    test: { setupFiles: ['./tests/fast-check.mutation.ts'] },
  }),
);
