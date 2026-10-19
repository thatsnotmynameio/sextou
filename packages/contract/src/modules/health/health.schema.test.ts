import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health.schema';

describe('healthResponseSchema', () => {
  it('accepts a version and a whole number of seconds', () => {
    expect(
      healthResponseSchema.parse({ version: '1.2.3', uptimeSeconds: 0 }),
    ).toEqual({ version: '1.2.3', uptimeSeconds: 0 });
  });

  it('rejects a body without a version', () => {
    expect(healthResponseSchema.safeParse({ uptimeSeconds: 0 }).success).toBe(
      false,
    );
  });

  it('rejects a negative uptime', () => {
    expect(
      healthResponseSchema.safeParse({ version: '1.2.3', uptimeSeconds: -1 })
        .success,
    ).toBe(false);
  });

  it('rejects a fractional uptime', () => {
    expect(
      healthResponseSchema.safeParse({ version: '1.2.3', uptimeSeconds: 1.5 })
        .success,
    ).toBe(false);
  });
});
