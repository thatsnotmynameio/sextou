import parent from '../../stryker.parent.conf.json' with { type: 'json' };

export default {
  ...parent,
  vitest: { configFile: 'vitest.mutation.config.ts' },
  // schema.ts is out of coverage, as vitest.config.ts says why.
  mutate: [...parent.mutate, '!src/index.ts', '!src/schema.ts'],
};
