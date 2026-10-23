import { Writable } from 'node:stream';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { startLeaseSweep } from '../../src/lease-sweep';
import { createLogger } from '../../src/logger';
import { Refusal } from '../../src/tasks';

let lines: string[];

// A logger that writes its records to lines.
function memoryLogger() {
  return createLogger(
    { level: 'info', pretty: false },
    new Writable({
      write: (chunk, _encoding, done) => {
        lines.push(String(chunk));
        done();
      },
    }),
  );
}

// A sweep every 100 ms that logs to lines, for leases of leaseMs: by
// default as long as the interval, so the first sweep ends leases.
function sweep(
  expire: Parameters<typeof startLeaseSweep>[0]['expire'],
  leaseMs = 100,
) {
  return startLeaseSweep({
    expire,
    intervalMs: 100,
    leaseMs,
    logger: memoryLogger(),
  });
}

const nothingExpired = async () => ({ ok: true as const, expired: 0 });

function records(): unknown[] {
  return lines.map((line) => JSON.parse(line));
}

beforeEach(() => {
  lines = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('startLeaseSweep calls expire once per interval, not before the first', async () => {
  const expire = vi.fn(async () => ({ ok: true as const, expired: 0 }));
  const running = sweep(expire);

  await vi.advanceTimersByTimeAsync(99);
  expect(expire).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(expire).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(100);
  expect(expire).toHaveBeenCalledTimes(2);
  await running.stop();
});

test('startLeaseSweep counts the interval from the end of the last call', async () => {
  let finish = () => {};
  const expire = vi.fn(
    () =>
      new Promise<{ ok: true; expired: number }>((resolve) => {
        finish = () => resolve({ ok: true, expired: 0 });
      }),
  );
  const running = sweep(expire);

  await vi.advanceTimersByTimeAsync(500);
  expect(expire).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(99);
  expect(expire).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(expire).toHaveBeenCalledTimes(2);
  finish();
  await running.stop();
});

test('startLeaseSweep ends no lease until the server has been up a whole lease', async () => {
  const expire = vi.fn(nothingExpired);
  const running = sweep(expire, 300);

  await vi.advanceTimersByTimeAsync(299);
  expect(expire).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(expire).toHaveBeenCalledTimes(1);
  await running.stop();
});

test('startLeaseSweep waits a whole lease again after a sweep that came late, logging it', async () => {
  const expire = vi.fn(nothingExpired);
  const running = sweep(expire, 300);
  await vi.advanceTimersByTimeAsync(300);

  // The host slept 10 s: the clock moved, the timers didn't.
  vi.setSystemTime(Date.now() + 10_000);
  await vi.advanceTimersByTimeAsync(100);
  expect(records()).toEqual([
    expect.objectContaining({
      level: 40,
      msg: 'The lease sweep ran late: ending no lease until the runners renew',
      lateMs: 10_000,
    }),
  ]);
  await vi.advanceTimersByTimeAsync(299);
  expect(expire).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(expire).toHaveBeenCalledTimes(2);
  await running.stop();
});

test.each([
  { lateMs: 100, calls: 2 },
  { lateMs: 101, calls: 1 },
])(
  'startLeaseSweep counts a sweep late past a third of the lease: $lateMs ms late leaves $calls calls',
  async ({ lateMs, calls }) => {
    const expire = vi.fn(nothingExpired);
    const running = sweep(expire, 300);
    await vi.advanceTimersByTimeAsync(300);

    vi.setSystemTime(Date.now() + lateMs);
    await vi.advanceTimersByTimeAsync(100);

    expect(expire).toHaveBeenCalledTimes(calls);
    await running.stop();
  },
);

test('startLeaseSweep logs how many attempts a sweep ended', async () => {
  const running = sweep(async () => ({ ok: true, expired: 2 }));

  await vi.advanceTimersByTimeAsync(100);

  expect(records()).toEqual([
    expect.objectContaining({
      level: 30,
      msg: 'Ended expired leases',
      expired: 2,
    }),
  ]);
  await running.stop();
});

test('startLeaseSweep logs nothing for a sweep that ended no attempt', async () => {
  const running = sweep(async () => ({ ok: true, expired: 0 }));

  await vi.advanceTimersByTimeAsync(100);

  expect(records()).toEqual([]);
  await running.stop();
});

test('startLeaseSweep logs a refused sweep and sweeps again', async () => {
  const expire = vi.fn(async () => ({
    ok: false as const,
    refusal: Refusal.invalid,
  }));
  const running = sweep(expire);

  await vi.advanceTimersByTimeAsync(200);

  expect(records()[0]).toEqual(
    expect.objectContaining({
      level: 50,
      msg: 'Could not end expired leases',
      refusal: 'invalid',
    }),
  );
  expect(expire).toHaveBeenCalledTimes(2);
  await running.stop();
});

test('startLeaseSweep logs a sweep that rejects and sweeps again', async () => {
  const expire = vi.fn(() => Promise.reject(new Error('disk I/O error')));
  const running = sweep(expire);

  await vi.advanceTimersByTimeAsync(200);

  expect(records()[0]).toEqual(
    expect.objectContaining({
      level: 50,
      msg: 'Could not end expired leases',
      err: expect.objectContaining({ message: 'disk I/O error' }),
    }),
  );
  expect(expire).toHaveBeenCalledTimes(2);
  await running.stop();
});

test('stop ends the sweeps before the first one runs', async () => {
  const expire = vi.fn(async () => ({ ok: true as const, expired: 0 }));
  const running = sweep(expire);

  await running.stop();
  await vi.advanceTimersByTimeAsync(1000);

  expect(expire).not.toHaveBeenCalled();
});

test('stop waits for the sweep in progress, and none runs after it', async () => {
  let finish = () => {};
  const expire = vi.fn(
    () =>
      new Promise<{ ok: true; expired: number }>((resolve) => {
        finish = () => resolve({ ok: true, expired: 0 });
      }),
  );
  const running = sweep(expire);
  await vi.advanceTimersByTimeAsync(100);

  let stopped = false;
  const stopping = running.stop().then(() => {
    stopped = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(stopped).toBe(false);
  finish();
  await stopping;
  await vi.advanceTimersByTimeAsync(1000);

  expect(expire).toHaveBeenCalledTimes(1);
});
