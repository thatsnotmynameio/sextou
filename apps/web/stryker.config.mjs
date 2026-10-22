import parent from '../../stryker.parent.conf.json' with { type: 'json' };

// The same files as coverage: the sources and the build's own modules,
// without main.tsx and the router plugin's routeTree.gen.ts.
export default {
  ...parent,
  mutate: [
    ...parent.mutate,
    'content-security-policy.ts',
    'settings.ts',
    '!src/main.tsx',
    '!src/routeTree.gen.ts',
  ],
  vitest: { configFile: 'vitest.mutation.config.ts' },
};
