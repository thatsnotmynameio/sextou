import path from 'node:path';
import { fc, test } from '@fast-check/vitest';
import { expect } from 'vitest';
import { loadConfig, type PathContext } from '../../src/config';

// The experiment's properties of loadConfig's own parsers.

const paths: PathContext = {
  platform: 'linux',
  homedir: () => '/home/ana',
  cwd: '/work',
};

function load(env: Record<string, string | undefined>) {
  return loadConfig(env, paths);
}

const runs = { numRuns: Number(process.env.PROPERTY_RUNS ?? 100) };

test.prop([fc.nat({ max: 65535 }), fc.nat({ max: 5 })], runs)(
  'loadConfig takes any port from 0 to 65535, with leading zeros too',
  (port, zeros) => {
    expect(
      load({ SEXTOU_SERVER_PORT: `${'0'.repeat(zeros)}${port}` }).port,
    ).toBe(port);
  },
);

test.prop([fc.integer({ min: 65536, max: Number.MAX_SAFE_INTEGER })], runs)(
  'loadConfig refuses any port above 65535',
  (port) => {
    expect(() => load({ SEXTOU_SERVER_PORT: String(port) })).toThrow(
      'Invalid SEXTOU_SERVER_PORT',
    );
  },
);

test.prop([fc.string().filter((value) => !/^\d+$/.test(value))], runs)(
  'loadConfig refuses any port that is not only digits',
  (value) => {
    expect(() => load({ SEXTOU_SERVER_PORT: value })).toThrow(
      'Invalid SEXTOU_SERVER_PORT',
    );
  },
);

test.prop(
  [fc.webUrl({ withQueryParameters: true, withFragments: true })],
  runs,
)(
  'loadConfig keeps only the origin of any http or https SEXTOU_SERVER_WEB_ORIGIN',
  (url) => {
    expect(load({ SEXTOU_SERVER_WEB_ORIGIN: url }).webOrigin).toBe(
      new URL(url).origin,
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
  'loadConfig refuses a SEXTOU_SERVER_WEB_ORIGIN of any scheme but http or https',
  (url) => {
    expect(() => load({ SEXTOU_SERVER_WEB_ORIGIN: url })).toThrow(
      'Invalid SEXTOU_SERVER_WEB_ORIGIN',
    );
  },
);

test.prop(
  [
    fc.string({ minLength: 1 }).filter((value) => value !== ':memory:'),
    fc.constantFrom('SEXTOU_SERVER_DATABASE', 'SEXTOU_SERVER_TASKS_DB'),
  ],
  runs,
)(
  'loadConfig makes any database path absolute against the working directory',
  (value, name) => {
    const config = load({ [name]: value });
    const database =
      name === 'SEXTOU_SERVER_DATABASE' ? config.database : config.tasksDb;
    expect(database).toBe(path.resolve('/work', value));
  },
);

test.prop([fc.string({ minLength: 1 })], runs)(
  'loadConfig makes any data folder absolute, with each database inside it',
  (value) => {
    const folder = path.resolve('/work', value);
    expect(load({ SEXTOU_SERVER_DATA_DIR: value })).toMatchObject({
      database: path.join(folder, 'sextou.db'),
      tasksDb: path.join(folder, 'tasks.db'),
    });
  },
);
