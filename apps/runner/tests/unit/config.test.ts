import { expect, test } from 'vitest';
import { loadConfig } from '../../src/config';

test('loadConfig uses every default when no variable is set', () => {
  expect(loadConfig({})).toEqual({
    serverUrl: 'http://127.0.0.1:4310',
    pollIntervalMs: 1000,
    requestTimeoutMs: 30000,
    dev: false,
    logLevel: 'info',
  });
});

test('loadConfig takes every variable that is set', () => {
  expect(
    loadConfig({
      SEXTOU_RUNNER_SERVER_URL: 'https://server.example',
      SEXTOU_RUNNER_POLL_INTERVAL_MS: '250',
      SEXTOU_RUNNER_REQUEST_TIMEOUT_MS: '5000',
      SEXTOU_RUNNER_DEV: 'true',
      SEXTOU_RUNNER_LOG_LEVEL: 'debug',
    }),
  ).toEqual({
    serverUrl: 'https://server.example',
    pollIntervalMs: 250,
    requestTimeoutMs: 5000,
    dev: true,
    logLevel: 'debug',
  });
});

test('loadConfig drops the trailing slashes of the server URL', () => {
  expect(
    loadConfig({ SEXTOU_RUNNER_SERVER_URL: 'http://server.test:4310/api//' })
      .serverUrl,
  ).toBe('http://server.test:4310/api');
});

test.each(['', 'server.test', 'ftp://server.test', 'file:///tmp/x'])(
  'loadConfig rejects the server URL %j',
  (url) => {
    expect(() => loadConfig({ SEXTOU_RUNNER_SERVER_URL: url })).toThrow(
      `Invalid SEXTOU_RUNNER_SERVER_URL: ${JSON.stringify(url)} (expected an http or https URL)`,
    );
  },
);

test.each([
  { name: 'SEXTOU_RUNNER_POLL_INTERVAL_MS', field: 'pollIntervalMs' },
  { name: 'SEXTOU_RUNNER_REQUEST_TIMEOUT_MS', field: 'requestTimeoutMs' },
] as const)(
  'loadConfig takes 1 and 2147483647 for $name',
  ({ name, field }) => {
    expect(loadConfig({ [name]: '1' })[field]).toBe(1);
    expect(loadConfig({ [name]: '2147483647' })[field]).toBe(2147483647);
  },
);

test.each(
  [
    'SEXTOU_RUNNER_POLL_INTERVAL_MS',
    'SEXTOU_RUNNER_REQUEST_TIMEOUT_MS',
  ].flatMap((name) =>
    ['', '0', '-1', '1.5', '1e3', 'abc', '2147483648'].map((value) => ({
      name,
      value,
    })),
  ),
)('loadConfig rejects $name $value', ({ name, value }) => {
  expect(() => loadConfig({ [name]: value })).toThrow(
    `Invalid ${name}: ${JSON.stringify(value)} (expected a whole number of milliseconds from 1 to 2147483647)`,
  );
});

test.each(['yes', 'TRUE', '1', ''])('loadConfig rejects dev %j', (value) => {
  expect(() => loadConfig({ SEXTOU_RUNNER_DEV: value })).toThrow(
    `Invalid SEXTOU_RUNNER_DEV: ${JSON.stringify(value)} (expected true or false)`,
  );
});

test.each(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])(
  'loadConfig takes the log level %s',
  (level) => {
    expect(loadConfig({ SEXTOU_RUNNER_LOG_LEVEL: level }).logLevel).toBe(level);
  },
);

test('loadConfig rejects an unknown log level, naming the ones it takes', () => {
  expect(() => loadConfig({ SEXTOU_RUNNER_LOG_LEVEL: 'verbose' })).toThrow(
    'Invalid SEXTOU_RUNNER_LOG_LEVEL: "verbose" (expected one of fatal, error, warn, info, debug, trace, silent)',
  );
});
