import { describe, expect, it } from 'vitest';
import { getHealth } from './health.service';

const startedAt = new Date('2026-10-19T12:00:00.000Z');

function after(ms: number) {
  return new Date(startedAt.getTime() + ms);
}

const base = { version: '1.2.3', startedAt, databaseAnswers: true };

describe('getHealth', () => {
  it('returns the version it is given', () => {
    expect(getHealth({ ...base, now: after(5000) }).version).toBe('1.2.3');
  });

  it('reports 0 seconds at the start time', () => {
    expect(getHealth({ ...base, now: startedAt }).uptimeSeconds).toBe(0);
  });

  it('rounds down to whole seconds', () => {
    expect(getHealth({ ...base, now: after(1999) }).uptimeSeconds).toBe(1);
  });

  // The clock can step back after the start (an NTP correction).
  it('reports 0 seconds when the current time is before the start time', () => {
    expect(getHealth({ ...base, now: after(-5000) }).uptimeSeconds).toBe(0);
  });

  it('counts the seconds since the start time', () => {
    expect(getHealth({ ...base, now: after(90_000) }).uptimeSeconds).toBe(90);
  });

  it('reports the database up when it answers', () => {
    expect(getHealth({ ...base, now: after(5000) })).toEqual({
      version: '1.2.3',
      uptimeSeconds: 5,
      database: 'up',
    });
  });

  it('reports the database down when it does not answer', () => {
    expect(
      getHealth({ ...base, databaseAnswers: false, now: after(5000) }),
    ).toEqual({ version: '1.2.3', uptimeSeconds: 5, database: 'down' });
  });
});
