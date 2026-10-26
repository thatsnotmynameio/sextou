import { expect, test } from 'vitest';
import { createLogger } from '../../src/logger';
import { memory } from '../../src/testing';

test('memory keeps every line a logger writes, in order', () => {
  const output = memory();
  const logger = createLogger(
    { level: 'info', pretty: false },
    output.destination,
  );
  logger.info('first');
  logger.info('second');
  expect(output.records()).toEqual([
    expect.objectContaining({ msg: 'first' }),
    expect.objectContaining({ msg: 'second' }),
  ]);
});
