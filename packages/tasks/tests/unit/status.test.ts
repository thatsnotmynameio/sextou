import { connect, type Database } from '@tursodatabase/database';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { finalStatuses, holds, Status, statusList } from '../../src/status';

// A name that is not one of the states.
const unknown = 'closed';

test('Status gives each state its own value', () => {
  const values = Object.values(Status);
  expect(new Set(values).size).toBe(values.length);
});

test('finalStatuses lists succeeded, failed and skipped', () => {
  expect(finalStatuses).toEqual([
    Status.succeeded,
    Status.failed,
    Status.skipped,
  ]);
});

test.each([Status.succeeded, Status.skipped])(
  'holds is false for %s, which frees the tasks it blocks',
  (status) => {
    expect(holds(status)).toBe(false);
  },
);

test.each([Status.open, Status.running, Status.failed])(
  'holds is true for %s, which keeps the tasks it blocks waiting',
  (status) => {
    expect(holds(status)).toBe(true);
  },
);

let client: Database;

beforeAll(async () => {
  client = await connect(':memory:');
});

afterAll(() => client.close());

async function inList(value: string) {
  return (await client.get(`SELECT ? IN (${statusList}) AS found`, value))
    ?.found;
}

test.each(Object.values(Status))(
  'statusList holds %s for SQL',
  async (status) => {
    expect(await inList(status)).toBe(1);
  },
);

test('statusList holds nothing else', async () => {
  expect(await inList(unknown)).toBe(0);
  expect(statusList.split(', ')).toHaveLength(Object.values(Status).length);
});
