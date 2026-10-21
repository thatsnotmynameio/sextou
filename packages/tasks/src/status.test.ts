import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { finalStatuses, holds, isFinal, Status, statusList } from './status';

// A name that is not one of the states.
const unknown = 'closed';

describe('Status', () => {
  it('gives each state its own value', () => {
    const values = Object.values(Status);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('finalStatuses', () => {
  it('lists succeeded, failed and skipped', () => {
    expect(finalStatuses).toEqual([
      Status.succeeded,
      Status.failed,
      Status.skipped,
    ]);
  });
});

describe('isFinal', () => {
  it.each(finalStatuses)('accepts %s', (status) => {
    expect(isFinal(status)).toBe(true);
  });

  it.each([Status.open, Status.running, unknown, '', undefined, null, 7])(
    'refuses %j',
    (value) => {
      expect(isFinal(value)).toBe(false);
    },
  );
});

describe('holds', () => {
  it.each([Status.succeeded, Status.skipped])(
    'is false for %s, which frees the tasks it blocks',
    (status) => {
      expect(holds(status)).toBe(false);
    },
  );

  it.each([Status.open, Status.running, Status.failed])(
    'is true for %s, which keeps the tasks it blocks waiting',
    (status) => {
      expect(holds(status)).toBe(true);
    },
  );
});

describe('statusList', () => {
  const client = new DatabaseSync(':memory:');
  const inList = client.prepare(`SELECT ? IN (${statusList}) AS found`);

  it.each(Object.values(Status))('holds %s for SQLite', (status) => {
    expect(inList.get(status)?.found).toBe(1);
  });

  it('holds nothing else', () => {
    expect(inList.get(unknown)?.found).toBe(0);
    expect(statusList.split(', ')).toHaveLength(Object.values(Status).length);
  });
});
