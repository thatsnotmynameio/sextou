import parent from '../../stryker.parent.conf.json' with { type: 'json' };

export default {
  ...parent,
  vitest: { configFile: 'vitest.mutation.config.ts' },
  // The scripts beside the Taskfiles, not their tests or this package's
  // configs; main.ts is out of coverage, as vitest.config.ts says why.
  mutate: ['**/*.ts', '!tests/**', '!*.config.ts', '!**/main.ts'],
  // Twice the 4 cores of GitHub's runner, as the runner's: the integration
  // tests wait on child processes (git, the fake claude, go-task).
  concurrency: 8,
};
