import { expect, test } from 'vitest';
import { readSettings } from './settings';

test('readSettings uses every default when no variable is set', () => {
  expect(readSettings({})).toEqual({
    serverUrl: 'http://127.0.0.1:4310',
    requestTimeoutMs: 30000,
    port: 5173,
  });
});

test('readSettings takes every variable that is set', () => {
  expect(
    readSettings({
      SEXTOU_WEB_SERVER_URL: 'https://api.example',
      SEXTOU_WEB_REQUEST_TIMEOUT_MS: '500',
      SEXTOU_WEB_PORT: '6100',
    }),
  ).toEqual({
    serverUrl: 'https://api.example',
    requestTimeoutMs: 500,
    port: 6100,
  });
});

// The client adds /trpc to it.
test('readSettings keeps a path in the server URL, without the trailing slash', () => {
  expect(
    readSettings({ SEXTOU_WEB_SERVER_URL: 'https://example.com/api/' })
      .serverUrl,
  ).toBe('https://example.com/api');
});

test.each(['', '127.0.0.1:4310', 'file:///server', 'ws://127.0.0.1:4310'])(
  'readSettings rejects server URL %j',
  (url) => {
    expect(() => readSettings({ SEXTOU_WEB_SERVER_URL: url })).toThrow(
      `Invalid SEXTOU_WEB_SERVER_URL: ${JSON.stringify(url)}`,
    );
  },
);

// The longest delay a timer takes; a longer one fires at once.
test('readSettings accepts a request timeout of 2147483647', () => {
  expect(
    readSettings({ SEXTOU_WEB_REQUEST_TIMEOUT_MS: '2147483647' })
      .requestTimeoutMs,
  ).toBe(2147483647);
});

test.each(['', '0', 'abc', '1.5', '-1', '1e3', '2147483648'])(
  'readSettings rejects request timeout %j',
  (timeout) => {
    expect(() =>
      readSettings({ SEXTOU_WEB_REQUEST_TIMEOUT_MS: timeout }),
    ).toThrow(
      `Invalid SEXTOU_WEB_REQUEST_TIMEOUT_MS: ${JSON.stringify(timeout)}`,
    );
  },
);

test('readSettings accepts port 65535', () => {
  expect(readSettings({ SEXTOU_WEB_PORT: '65535' }).port).toBe(65535);
});

test.each(['', '0', 'abc', '0x50', '-1', '65536'])(
  'readSettings rejects port %j',
  (port) => {
    expect(() => readSettings({ SEXTOU_WEB_PORT: port })).toThrow(
      `Invalid SEXTOU_WEB_PORT: ${JSON.stringify(port)}`,
    );
  },
);
