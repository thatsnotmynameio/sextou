import { describe, expect, it } from 'vitest';
import { getHealth } from './health.service';

const startedAt = new Date('2026-10-19T12:00:00.000Z');

function after(ms: number) {
  return new Date(startedAt.getTime() + ms);
}

describe('getHealth', () => {
  it('returns the version it is given', () => {
    expect(
      getHealth({ version: '1.2.3', startedAt, now: after(5000) }).version,
    ).toBe('1.2.3');
  });

  it('reports 0 seconds at the start time', () => {
    expect(
      getHealth({ version: '1.2.3', startedAt, now: startedAt }).uptimeSeconds,
    ).toBe(0);
  });

  it('rounds down to whole seconds', () => {
    expect(
      getHealth({ version: '1.2.3', startedAt, now: after(1999) })
        .uptimeSeconds,
    ).toBe(1);
  });

  it('counts the seconds since the start time', () => {
    expect(
      getHealth({ version: '1.2.3', startedAt, now: after(90_000) })
        .uptimeSeconds,
    ).toBe(90);
  });
});
