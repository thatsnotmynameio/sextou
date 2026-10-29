import { fc } from '@fast-check/vitest';

// Under Stryker every run draws the same inputs, so the tests that cover a
// mutant in the dry run are the ones that run for it, and a failure ends the
// property at once: Stryker needs only that it failed, not its smallest case.
fc.configureGlobal({ seed: 42, endOnFailure: true });
