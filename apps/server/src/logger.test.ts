import { expect, test } from 'vitest';
import { createLogger } from './logger';

// A destination that keeps each line the logger writes.
function memory() {
  const lines: string[] = [];
  return {
    lines,
    records: () => lines.map((line) => JSON.parse(line) as unknown),
    destination: {
      write: (line: string) => {
        lines.push(line);
      },
    },
  };
}

test('createLogger writes an info call as one JSON line', () => {
  const output = memory();
  createLogger('info', output.destination).info('ready');
  expect(output.records()).toEqual([
    expect.objectContaining({ level: 30, msg: 'ready' }),
  ]);
});

test('createLogger at info writes nothing for a debug call', () => {
  const output = memory();
  createLogger('info', output.destination).debug('detail');
  expect(output.lines).toEqual([]);
});

test('createLogger at debug writes a debug call', () => {
  const output = memory();
  createLogger('debug', output.destination).debug('detail');
  expect(output.records()).toEqual([
    expect.objectContaining({ level: 20, msg: 'detail' }),
  ]);
});

test('createLogger at silent writes nothing for an error call', () => {
  const output = memory();
  createLogger('silent', output.destination).error('failed');
  expect(output.lines).toEqual([]);
});

test('createLogger writes an error passed as err with its type, message and stack', () => {
  const output = memory();
  const error = new TypeError('broken');
  createLogger('info', output.destination).error({ err: error }, 'failed');
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
