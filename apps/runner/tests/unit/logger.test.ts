import { expect, test, vi } from 'vitest';
import { createLogger } from '../../src/logger';
import { memory } from '../memory';

test('createLogger writes an info call as one JSON line', () => {
  const output = memory();
  createLogger({ level: 'info', pretty: false }, output.destination).info(
    { url: 'http://server.test' },
    'polling',
  );
  expect(output.records()).toEqual([
    expect.objectContaining({
      level: 30,
      msg: 'polling',
      url: 'http://server.test',
    }),
  ]);
});

test('createLogger at warn writes nothing for an info call', () => {
  const output = memory();
  createLogger({ level: 'warn', pretty: false }, output.destination).info(
    'no task',
  );
  expect(output.lines).toEqual([]);
});

test('createLogger at warn writes a warn call', () => {
  const output = memory();
  createLogger({ level: 'warn', pretty: false }, output.destination).warn(
    'request failed',
  );
  expect(output.records()).toEqual([
    expect.objectContaining({ level: 40, msg: 'request failed' }),
  ]);
});

test('createLogger with pretty writes a readable line, not JSON', async () => {
  const output = memory();
  createLogger({ level: 'info', pretty: true }, output.destination).info(
    'no task',
  );
  await vi.waitFor(() => expect(output.lines.join('')).toContain('no task'));
  expect(output.lines.join('')).toContain('INFO');
  expect(() => JSON.parse(output.lines.join(''))).toThrow(SyntaxError);
});
