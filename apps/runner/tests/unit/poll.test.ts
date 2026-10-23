import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createClient } from '../../src/client';
import { createLogger } from '../../src/logger';
import { poll } from '../../src/poll';
import { memory } from '../memory';

const intervalMs = 1000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const noTask = () => Response.json({ result: { data: { task: null } } });

const refused = () =>
  Promise.reject(new TypeError('fetch failed', { cause: 'ECONNREFUSED' }));

// Starts the loop against a stubbed fetch, with the records it writes.
function start(
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  const stubbed = vi.fn(fetch);
  vi.stubGlobal('fetch', stubbed);
  const output = memory();
  const controller = new AbortController();
  const running = poll({
    client: createClient('http://server.test', 60_000),
    intervalMs,
    logger: createLogger({ level: 'info', pretty: false }, output.destination),
    signal: controller.signal,
  });
  return {
    fetch: stubbed,
    records: output.records,
    messages: () => output.records().map((record) => record.msg),
    stop: async () => {
      controller.abort();
      await running;
    },
  };
}

// Covers AE1.
test('poll logs no task for each answer, once per interval', async () => {
  const loop = start(async () => noTask());

  await vi.advanceTimersByTimeAsync(intervalMs * 2);
  await loop.stop();

  expect(loop.messages()).toEqual(['no task', 'no task', 'no task']);
  expect(loop.records()[0]).toMatchObject({ level: 30 });
});

test('poll asks again one interval after the previous answer, not after the previous request started', async () => {
  const startedAt: number[] = [];
  const loop = start(async () => {
    startedAt.push(Date.now());
    // Only the first answer is slow: the loop stops during the second
    // request, which this stub can't abort.
    if (startedAt.length === 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    return noTask();
  });

  await vi.advanceTimersByTimeAsync(5000 + intervalMs);
  await loop.stop();

  expect(startedAt.map((at) => at - (startedAt[0] ?? 0))).toEqual([0, 6000]);
});

// Covers AE2.
test('poll logs a refused request as no answer', async () => {
  const loop = start(refused);

  await vi.advanceTimersByTimeAsync(0);
  await loop.stop();

  expect(loop.records()).toEqual([
    expect.objectContaining({
      level: 40,
      msg: 'request failed',
      kind: 'no-answer',
    }),
  ]);
});

// Covers AE2.
test('poll asks again an interval after a refused request', async () => {
  const loop = start(refused);

  await vi.advanceTimersByTimeAsync(intervalMs);
  await loop.stop();

  expect(loop.fetch).toHaveBeenCalledTimes(2);
  expect(loop.messages()).toEqual(['request failed', 'request failed']);
});

// Covers AE2.
test('poll logs no task again once a server that was down answers', async () => {
  let attempts = 0;
  const loop = start(async () => (++attempts <= 2 ? refused() : noTask()));

  await vi.advanceTimersByTimeAsync(intervalMs * 2);
  await loop.stop();

  expect(loop.messages()).toEqual([
    'request failed',
    'request failed',
    'no task',
  ]);
});

test('poll logs an error the server sent as a server error with its code', async () => {
  const loop = start(async () =>
    Response.json(
      {
        error: {
          message: 'No procedure found on path "runner.next"',
          code: -32004,
          data: { code: 'NOT_FOUND', httpStatus: 404, path: 'runner.next' },
        },
      },
      { status: 404 },
    ),
  );

  await vi.advanceTimersByTimeAsync(0);
  await loop.stop();

  expect(loop.records()).toEqual([
    expect.objectContaining({
      level: 40,
      msg: 'request failed',
      kind: 'server-error',
      code: 'NOT_FOUND',
      error: 'No procedure found on path "runner.next"',
    }),
  ]);
});

test('poll logs an answer that is not tRPC’s as no answer', async () => {
  const loop = start(
    async () => new Response('<h1>Bad gateway</h1>', { status: 502 }),
  );

  await vi.advanceTimersByTimeAsync(0);
  await loop.stop();

  expect(loop.records()).toEqual([
    expect.objectContaining({ msg: 'request failed', kind: 'no-answer' }),
  ]);
});

test('poll writes no stack in a failure record', async () => {
  const loop = start(refused);

  await vi.advanceTimersByTimeAsync(0);
  await loop.stop();

  expect(loop.records()).toHaveLength(1);
  expect(JSON.stringify(loop.records())).not.toContain('stack');
});

test('poll stops during the wait without asking again', async () => {
  const loop = start(async () => noTask());

  await vi.advanceTimersByTimeAsync(intervalMs / 2);
  await loop.stop();

  expect(loop.fetch).toHaveBeenCalledTimes(1);
  expect(loop.messages()).toEqual(['no task']);
});

test('poll stops during a request without logging it as failed', async () => {
  const loop = start(
    (_input, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(init.signal?.reason),
        );
      }),
  );

  await vi.advanceTimersByTimeAsync(0);
  await loop.stop();

  expect(loop.fetch).toHaveBeenCalledTimes(1);
  expect(loop.records()).toEqual([]);
});
