import parent from '../../stryker.parent.conf.json' with { type: 'json' };

export default {
  ...parent,
  // related is off: the drift test reaches src/schema.ts through drizzle-kit,
  // not an import, so Vitest would not count it as a test of that file.
  vitest: { configFile: 'vitest.mutation.config.ts', related: false },
  mutate: [...parent.mutate, '!src/index.ts'],
};
