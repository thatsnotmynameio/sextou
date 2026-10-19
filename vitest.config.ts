// CI runs `vitest run` at the repository root: this points it at each
// package's unit suite, with that package's own configuration.
export default {
  test: {
    projects: ['packages/ui'],
  },
};
