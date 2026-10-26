import parent from '../../stryker.parent.conf.json' with { type: 'json' };

export default {
  ...parent,
  vitest: { configFile: 'vitest.mutation.config.mts' },
  // The databases the server keeps from source, which no test reads.
  ignorePatterns: ['/storage'],
};
