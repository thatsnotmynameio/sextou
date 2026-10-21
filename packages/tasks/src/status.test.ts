import { connect, type Database } from '@tursodatabase/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  let client: Database;

  beforeAll(async () => {
    client = await connect(':memory:');
  });

  afterAll(() => client.close());

  async function inList(value: string) {
    return (await client.get(`SELECT ? IN (${statusList}) AS found`, value))
      ?.found;
  }

  it.each(Object.values(Status))('holds %s for SQL', async (status) => {
    expect(await inList(status)).toBe(1);
  });

  it('holds nothing else', async () => {
    expect(await inList(unknown)).toBe(0);
    expect(statusList.split(', ')).toHaveLength(Object.values(Status).length);
  });
});
