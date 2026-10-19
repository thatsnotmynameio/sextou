import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health.schema';

describe('healthResponseSchema', () => {
  it.each(['up', 'down'])('accepts a body whose database is %j', (database) => {
    const body = { version: '1.2.3', uptimeSeconds: 0, database };
    expect(healthResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects a body without a version', () => {
    expect(
      healthResponseSchema.safeParse({ uptimeSeconds: 0, database: 'up' })
        .success,
    ).toBe(false);
  });

  it('rejects a body without the database status', () => {
    expect(
      healthResponseSchema.safeParse({ version: '1.2.3', uptimeSeconds: 0 })
        .success,
    ).toBe(false);
  });

  it('rejects a database status other than up or down', () => {
    expect(
      healthResponseSchema.safeParse({
        version: '1.2.3',
        uptimeSeconds: 0,
        database: 'unknown',
      }).success,
    ).toBe(false);
  });

  it('rejects a negative uptime', () => {
    expect(
      healthResponseSchema.safeParse({
        version: '1.2.3',
        uptimeSeconds: -1,
        database: 'up',
      }).success,
    ).toBe(false);
  });

  it('rejects a fractional uptime', () => {
    expect(
      healthResponseSchema.safeParse({
        version: '1.2.3',
        uptimeSeconds: 1.5,
        database: 'up',
      }).success,
    ).toBe(false);
  });
});
