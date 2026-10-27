import parent from '../../stryker.parent.conf.json' with { type: 'json' };

export default {
  ...parent,
  vitest: { configFile: 'vitest.mutation.config.mts' },
  // Twice the 4 cores of GitHub's runner: the integration tests mostly wait
  // on child processes (the server, go-task, tar), so 8 workers on 4 cores
  // ran the package's mutants in a fifth less time than 4, killing as many.
  concurrency: 8,
};
