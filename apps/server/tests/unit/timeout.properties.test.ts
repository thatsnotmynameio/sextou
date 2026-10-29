import { fc, test } from '@fast-check/vitest';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { withTimeout } from '../../src/timeout';

// The experiment's property of withTimeout: whichever comes first wins.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const runs = { numRuns: Number(process.env.PROPERTY_RUNS ?? 100) };

test.prop(
  [
    fc.integer({ min: 1, max: 1_000_000 }),
    fc.integer({ min: 0, max: 1_000_000 }),
    fc.anything(),
  ],
  runs,
)(
  'withTimeout settles with the value of a promise that settles before the time, and rejects otherwise',
  async (ms, delay, value) => {
    fc.pre(delay !== ms);
    const settled = withTimeout(
      new Promise((resolve) => setTimeout(() => resolve(value), delay)),
      ms,
    ).then(
      (result) => ({ result }),
      (error: Error) => ({ error: error.message }),
    );

    await vi.advanceTimersByTimeAsync(Math.max(ms, delay));

    expect(await settled).toEqual(
      delay < ms ? { result: value } : { error: `Timed out after ${ms} ms` },
    );
    expect(vi.getTimerCount()).toBe(0);
  },
);
