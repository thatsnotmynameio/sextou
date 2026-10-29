import { fc, test } from '@fast-check/vitest';
import { expect } from 'vitest';
import { readSettings } from '../../settings';

// The experiment's properties of readSettings.

const runs = { numRuns: Number(process.env.PROPERTY_RUNS ?? 100) };

test.prop(
  [
    fc.webUrl({ withQueryParameters: true, withFragments: true }),
    fc.nat({ max: 4 }),
  ],
  runs,
)(
  'readSettings takes any http or https server URL as the URL parses, without its trailing slashes',
  (url, slashes) => {
    const { serverUrl } = readSettings({
      SEXTOU_WEB_SERVER_URL: `${url}${'/'.repeat(slashes)}`,
    });
    expect(serverUrl.endsWith('/')).toBe(false);
    expect(serverUrl).toBe(
      new URL(`${url}${'/'.repeat(slashes)}`).href.replace(/\/+$/, ''),
    );
  },
);

test.prop(
  [
    fc
      .tuple(
        fc.webUrl(),
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'),
        fc.string({
          unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789+.-'),
          maxLength: 8,
        }),
      )
      .map(([url, first, rest]) => ({ url, scheme: `${first}${rest}` }))
      .filter(({ scheme }) => scheme !== 'http' && scheme !== 'https')
      .map(({ url, scheme }) => url.replace(/^https?/, scheme)),
  ],
  runs,
)(
  'readSettings refuses a server URL of any scheme but http or https',
  (url) => {
    expect(() => readSettings({ SEXTOU_WEB_SERVER_URL: url })).toThrow(
      'Invalid SEXTOU_WEB_SERVER_URL',
    );
  },
);

test.prop([fc.integer({ min: 1, max: 2147483647 }), fc.nat({ max: 3 })], runs)(
  'readSettings takes any request timeout from 1 to 2147483647, with leading zeros too',
  (ms, zeros) => {
    expect(
      readSettings({
        SEXTOU_WEB_REQUEST_TIMEOUT_MS: `${'0'.repeat(zeros)}${ms}`,
      }).requestTimeoutMs,
    ).toBe(ms);
  },
);

test.prop(
  [
    fc.oneof(
      fc.string().filter((value) => !/^\d+$/.test(value)),
      fc.integer({ min: 2147483648, max: Number.MAX_SAFE_INTEGER }).map(String),
      fc.nat({ max: 4 }).map((zeros) => '0'.repeat(zeros + 1)),
    ),
  ],
  runs,
)('readSettings refuses any other request timeout', (value) => {
  expect(() => readSettings({ SEXTOU_WEB_REQUEST_TIMEOUT_MS: value })).toThrow(
    'Invalid SEXTOU_WEB_REQUEST_TIMEOUT_MS',
  );
});

test.prop([fc.integer({ min: 1, max: 65535 })], runs)(
  'readSettings takes any port from 1 to 65535',
  (port) => {
    expect(readSettings({ SEXTOU_WEB_PORT: String(port) }).port).toBe(port);
  },
);

test.prop(
  [
    fc.oneof(
      fc.string().filter((value) => !/^\d+$/.test(value)),
      fc.integer({ min: 65536, max: Number.MAX_SAFE_INTEGER }).map(String),
      fc.nat({ max: 4 }).map((zeros) => '0'.repeat(zeros + 1)),
    ),
  ],
  runs,
)('readSettings refuses any other port', (value) => {
  expect(() => readSettings({ SEXTOU_WEB_PORT: value })).toThrow(
    'Invalid SEXTOU_WEB_PORT',
  );
});
