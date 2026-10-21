import { expect, test } from 'vitest';
import { getHealth } from './health.service';

const startedAt = new Date('2026-10-19T12:00:00.000Z');

function after(ms: number) {
  return new Date(startedAt.getTime() + ms);
}

const base = { version: '1.2.3', startedAt, databaseAnswers: true };

test('getHealth returns the version it is given', () => {
  expect(getHealth({ ...base, now: after(5000) }).version).toBe('1.2.3');
});

test('getHealth reports 0 seconds at the start time', () => {
  expect(getHealth({ ...base, now: startedAt }).uptimeSeconds).toBe(0);
});

test('getHealth rounds down to whole seconds', () => {
  expect(getHealth({ ...base, now: after(1999) }).uptimeSeconds).toBe(1);
});

// The clock can step back after the start (an NTP correction).
test('getHealth reports 0 seconds when the current time is before the start time', () => {
  expect(getHealth({ ...base, now: after(-5000) }).uptimeSeconds).toBe(0);
});

test('getHealth counts the seconds since the start time', () => {
  expect(getHealth({ ...base, now: after(90_000) }).uptimeSeconds).toBe(90);
});

test('getHealth reports the database up when it answers', () => {
  expect(getHealth({ ...base, now: after(5000) })).toEqual({
    version: '1.2.3',
    uptimeSeconds: 5,
    database: 'up',
  });
});

test('getHealth reports the database down when it does not answer', () => {
  expect(
    getHealth({ ...base, databaseAnswers: false, now: after(5000) }),
  ).toEqual({ version: '1.2.3', uptimeSeconds: 5, database: 'down' });
});
