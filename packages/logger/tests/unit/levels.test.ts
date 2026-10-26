import { pino } from 'pino';
import { expect, test } from 'vitest';
import { logLevels } from '../../src/levels';

test('logLevels lists Pino levels from the highest, then silent', () => {
  const pinoLevels = Object.entries(pino.levels.values)
    .toSorted(([, a], [, b]) => b - a)
    .map(([name]) => name);
  expect(logLevels).toEqual([...pinoLevels, 'silent']);
});
