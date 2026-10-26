import { expect, test } from 'vitest';
import {
  invalid,
  parseBoolean,
  parseCount,
  parseOneOf,
  parseTimeout,
  reader,
} from '../../src/config';

const timeoutError = (value: string) =>
  `Invalid SEXTOU_TIMEOUT_MS: ${JSON.stringify(value)} (expected a whole number of milliseconds from 1 to 2147483647)`;

test('reader parses a set variable with its name', () => {
  const read = reader({ SEXTOU_PORT: '80' });
  expect(
    read(
      'SEXTOU_PORT',
      (value, name) => `${name}=${value}`,
      () => 'unset',
    ),
  ).toBe('SEXTOU_PORT=80');
});

test('reader returns the fallback for an unset variable', () => {
  const read = reader({});
  expect(
    read(
      'SEXTOU_PORT',
      () => 'parsed',
      () => 'unset',
    ),
  ).toBe('unset');
});

test('reader parses an empty variable rather than falling back', () => {
  const read = reader({ SEXTOU_HOST: '' });
  expect(
    read(
      'SEXTOU_HOST',
      (value) => `[${value}]`,
      () => 'unset',
    ),
  ).toBe('[]');
});

test('invalid names the variable, the value as JSON and what it expects', () => {
  expect(invalid('SEXTOU_PORT', 'x"y', 'a port').message).toBe(
    'Invalid SEXTOU_PORT: "x\\"y" (expected a port)',
  );
});

test.each([
  ['1', 1],
  ['7', 7],
  ['10', 10],
])('parseCount takes %j within 1 to the max', (value, expected) => {
  expect(parseCount(value, 'SEXTOU_COUNT', 10, 'a count')).toBe(expected);
});

test.each(['0', '11', '', '-1', '1.5', '1e1', ' 1', '0x1', 'abc'])(
  'parseCount refuses %j',
  (value) => {
    expect(() => parseCount(value, 'SEXTOU_COUNT', 10, 'a count')).toThrow(
      `Invalid SEXTOU_COUNT: ${JSON.stringify(value)} (expected a count)`,
    );
  },
);

test.each([
  ['1', 1],
  ['2147483647', 2147483647],
])('parseTimeout takes %j', (value, expected) => {
  expect(parseTimeout(value, 'SEXTOU_TIMEOUT_MS')).toBe(expected);
});

test.each(['0', '2147483648', '', '1.5'])(
  'parseTimeout refuses %j',
  (value) => {
    expect(() => parseTimeout(value, 'SEXTOU_TIMEOUT_MS')).toThrow(
      timeoutError(value),
    );
  },
);

test.each([
  ['true', true],
  ['false', false],
])('parseBoolean takes %j', (value, expected) => {
  expect(parseBoolean(value, 'SEXTOU_DEV')).toBe(expected);
});

test.each(['', 'TRUE', '1', 'yes'])('parseBoolean refuses %j', (value) => {
  expect(() => parseBoolean(value, 'SEXTOU_DEV')).toThrow(
    `Invalid SEXTOU_DEV: ${JSON.stringify(value)} (expected true or false)`,
  );
});

test.each(['info', 'debug'])('parseOneOf takes %j from its values', (value) => {
  expect(parseOneOf(['info', 'debug'])(value, 'SEXTOU_LOG_LEVEL')).toBe(value);
});

test.each(['', 'INFO', 'warn'])(
  'parseOneOf refuses %j, listing its values',
  (value) => {
    expect(() =>
      parseOneOf(['info', 'debug'])(value, 'SEXTOU_LOG_LEVEL'),
    ).toThrow(
      `Invalid SEXTOU_LOG_LEVEL: ${JSON.stringify(value)} (expected one of info, debug)`,
    );
  },
);
