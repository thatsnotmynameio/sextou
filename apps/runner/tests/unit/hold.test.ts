import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { hold } from '../../src/hold';
import { createLogger } from '../../src/logger';
import type { Task } from '../../src/runner';

const task = { id: 'tsk_1' } as Task;
const logger = createLogger({ level: 'silent', pretty: false });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('hold resolves succeeded once holdMs pass', async () => {
  let result: unknown;
  void hold(1000)(task, { signal: new AbortController().signal, logger }).then(
    (value) => {
      result = value;
    },
  );
  await vi.advanceTimersByTimeAsync(999);
  expect(result).toBeUndefined();

  await vi.advanceTimersByTimeAsync(1);

  expect(result).toEqual({ outcome: 'succeeded' });
});

test('hold resolves failed as aborted at once when its signal aborts', async () => {
  const controller = new AbortController();
  const running = hold(1000)(task, { signal: controller.signal, logger });

  controller.abort();

  expect(await running).toEqual({ outcome: 'failed', reason: 'aborted' });
  expect(vi.getTimerCount()).toBe(0);
});
