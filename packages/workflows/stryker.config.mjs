import parent from '../../stryker.parent.conf.json' with { type: 'json' };

export default {
  ...parent,
  vitest: { configFile: 'vitest.mutation.config.ts' },
  // The scripts beside the Taskfiles, not their tests or this package's
  // configs; main.ts is out of coverage, as vitest.config.ts says why.
  mutate: ['**/*.ts', '!tests/**', '!*.config.ts', '!**/main.ts'],
};
