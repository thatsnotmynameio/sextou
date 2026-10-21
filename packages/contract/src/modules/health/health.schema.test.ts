import { expect, test } from 'vitest';
import { healthResponseSchema } from './health.schema';

test.each(['up', 'down'])(
  'healthResponseSchema accepts a body whose database is %j',
  (database) => {
    const body = { version: '1.2.3', uptimeSeconds: 0, database };
    expect(healthResponseSchema.parse(body)).toEqual(body);
  },
);

test('healthResponseSchema rejects a body without a version', () => {
  expect(
    healthResponseSchema.safeParse({ uptimeSeconds: 0, database: 'up' })
      .success,
  ).toBe(false);
});

test('healthResponseSchema rejects a body without the database status', () => {
  expect(
    healthResponseSchema.safeParse({ version: '1.2.3', uptimeSeconds: 0 })
      .success,
  ).toBe(false);
});

test('healthResponseSchema rejects a database status other than up or down', () => {
  expect(
    healthResponseSchema.safeParse({
      version: '1.2.3',
      uptimeSeconds: 0,
      database: 'unknown',
    }).success,
  ).toBe(false);
});

test('healthResponseSchema rejects a negative uptime', () => {
  expect(
    healthResponseSchema.safeParse({
      version: '1.2.3',
      uptimeSeconds: -1,
      database: 'up',
    }).success,
  ).toBe(false);
});

test('healthResponseSchema rejects a fractional uptime', () => {
  expect(
    healthResponseSchema.safeParse({
      version: '1.2.3',
      uptimeSeconds: 1.5,
      database: 'up',
    }).success,
  ).toBe(false);
});
