import { expect, test, vi } from 'vitest';
import { createLogger } from '../../src/logger';
import { memory } from '../../src/testing';

test('createLogger writes an info call as one JSON line', () => {
  const output = memory();
  createLogger({ level: 'info', pretty: false }, output.destination).info(
    'ready',
  );
  expect(output.records()).toEqual([
    expect.objectContaining({ level: 30, msg: 'ready' }),
  ]);
});

test('createLogger at info writes nothing for a debug call', () => {
  const output = memory();
  createLogger({ level: 'info', pretty: false }, output.destination).debug(
    'detail',
  );
  expect(output.lines).toEqual([]);
});

test('createLogger at debug writes a debug call', () => {
  const output = memory();
  createLogger({ level: 'debug', pretty: false }, output.destination).debug(
    'detail',
  );
  expect(output.records()).toEqual([
    expect.objectContaining({ level: 20, msg: 'detail' }),
  ]);
});

test('createLogger at silent writes nothing for an error call', () => {
  const output = memory();
  createLogger({ level: 'silent', pretty: false }, output.destination).error(
    'failed',
  );
  expect(output.lines).toEqual([]);
});

test('createLogger writes an error passed as err with its type, message and stack', () => {
  const output = memory();
  const error = new TypeError('broken');
  createLogger({ level: 'info', pretty: false }, output.destination).error(
    { err: error },
    'failed',
  );
  expect(output.records()).toEqual([
    expect.objectContaining({
      level: 50,
      msg: 'failed',
      err: expect.objectContaining({
        type: 'TypeError',
        message: 'broken',
        stack: error.stack,
      }),
    }),
  ]);
});

test('createLogger with pretty writes a readable line, not JSON', async () => {
  const output = memory();
  createLogger({ level: 'info', pretty: true }, output.destination).info(
    'ready',
  );
  await vi.waitFor(() => expect(output.lines.join('')).toContain('ready'));
  expect(output.lines.join('')).toContain('INFO');
  expect(() => JSON.parse(output.lines.join(''))).toThrow(SyntaxError);
});
