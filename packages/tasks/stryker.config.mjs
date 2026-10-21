import parent from '../../stryker.parent.conf.json' with { type: 'json' };

export default {
  ...parent,
  vitest: { configFile: 'vitest.mutation.config.ts' },
  mutate: [...parent.mutate, '!src/index.ts'],
};
