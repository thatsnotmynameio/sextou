import parent from '../../stryker.parent.conf.json' with { type: 'json' };

export default {
  ...parent,
  mutate: [...parent.mutate, '!src/**/*.stories.tsx', '!src/index.ts'],
};
