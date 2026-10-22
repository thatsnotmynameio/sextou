import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { withTimeout } from './timeout';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('withTimeout resolves with the value of a promise that settles in time', async () => {
  await expect(withTimeout(Promise.resolve('done'), 100)).resolves.toBe('done');
});

test('withTimeout rejects with the error of a promise that rejects in time', async () => {
  const error = new Error('failed');
  await expect(withTimeout(Promise.reject(error), 100)).rejects.toBe(error);
});

test('withTimeout rejects once the time passes on a promise that never settles', async () => {
  const result = withTimeout(new Promise(() => {}), 100);
  const assertion = expect(result).rejects.toThrow('Timed out after 100 ms');

  await vi.advanceTimersByTimeAsync(100);

  await assertion;
});

test('withTimeout waits the whole time before rejecting', async () => {
  let settled = false;
  void withTimeout(new Promise(() => {}), 100).catch(() => {
    settled = true;
  });

  await vi.advanceTimersByTimeAsync(99);

  expect(settled).toBe(false);
});

test('withTimeout clears its timer once the promise settles', async () => {
  await withTimeout(Promise.resolve(), 100);

  expect(vi.getTimerCount()).toBe(0);
});
