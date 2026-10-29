import { fc, test } from '@fast-check/vitest';
import { expect } from 'vitest';
import { policy } from '../../content-security-policy';

// The experiment's property of the policy: whatever the server's URL, it adds
// only that URL's origin to connect-src, and no directive.

const runs = { numRuns: Number(process.env.PROPERTY_RUNS ?? 100) };

test.prop(
  [
    fc.webUrl({
      withQueryParameters: true,
      withFragments: true,
      authoritySettings: { withPort: true, withUserInfo: true, withIPv4: true },
    }),
  ],
  runs,
)(
  'policy lets the page connect to the origin of any server URL, and to nothing else',
  (url) => {
    expect(policy(url).split('; ')).toEqual([
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self'",
      "font-src 'self'",
      `connect-src 'self' ${new URL(url).origin}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ]);
    expect(new URL(url).origin).not.toMatch(/[\s;,']/);
  },
);
