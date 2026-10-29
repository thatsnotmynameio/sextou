import { fc, test } from '@fast-check/vitest';
import { expect } from 'vitest';
import { loadConfig } from '../../src/config';

// The experiment's properties of loadConfig's own parsers: the assignees,
// the URLs and the tasks file's limit.

function load(env: Record<string, string | undefined>) {
  return loadConfig(env, { hostname: () => 'box' });
}

// A name with no comma and something left once trimmed, as given.
const assignee = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((name) => !name.includes(',') && name.trim() !== '');
const padding = fc.constantFrom('', ' ', '\t', '  ');

test.prop(
  [
    fc.array(fc.tuple(padding, assignee, padding), {
      minLength: 1,
      maxLength: 6,
    }),
  ],
  { numRuns: Number(process.env.CONFIG_PROPERTY_RUNS ?? 100) },
)(
  'loadConfig takes any names separated by commas as the assignees, each trimmed',
  (names) => {
    const value = names
      .map(([before, name, after]) => `${before}${name}${after}`)
      .join(',');

    expect(load({ SEXTOU_RUNNER_ASSIGNEES: value }).assignees).toEqual(
      names.map(([, name]) => name.trim()),
    );
  },
);

test.prop([fc.array(assignee, { maxLength: 5 }), fc.nat(), padding], {
  numRuns: Number(process.env.CONFIG_PROPERTY_RUNS ?? 100),
})(
  'loadConfig rejects any SEXTOU_RUNNER_ASSIGNEES with an empty name anywhere',
  (names, at, blank) => {
    const value = names.toSpliced(at % (names.length + 1), 0, blank).join(',');

    expect(() => load({ SEXTOU_RUNNER_ASSIGNEES: value })).toThrow(
      `Invalid SEXTOU_RUNNER_ASSIGNEES: ${JSON.stringify(value)} (expected names separated by commas)`,
    );
  },
);

const url = fc.webUrl({ withQueryParameters: true, withFragments: true });

test.prop([url, fc.nat({ max: 4 })], {
  numRuns: Number(process.env.CONFIG_PROPERTY_RUNS ?? 100),
})(
  'loadConfig takes any http or https server URL without its trailing slashes, the same URL read again',
  (value, slashes) => {
    const serverUrl = load({
      SEXTOU_RUNNER_SERVER_URL: `${value}${'/'.repeat(slashes)}`,
    }).serverUrl;

    expect(serverUrl.endsWith('/')).toBe(false);
    expect(load({ SEXTOU_RUNNER_SERVER_URL: serverUrl }).serverUrl).toBe(
      serverUrl,
    );
  },
);

test.prop(
  [
    url.map((value) => value.replace(/^https?:/, '')),
    fc.constantFrom('ftp:', 'file:', 'ws:', ''),
  ],
  { numRuns: Number(process.env.CONFIG_PROPERTY_RUNS ?? 100) },
)(
  'loadConfig rejects any server URL that is not http or https',
  (rest, scheme) => {
    expect(() =>
      load({ SEXTOU_RUNNER_SERVER_URL: `${scheme}${rest}` }),
    ).toThrow('Invalid SEXTOU_RUNNER_SERVER_URL');
  },
);

test.prop([fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER })], {
  numRuns: Number(process.env.CONFIG_PROPERTY_RUNS ?? 100),
})(
  'loadConfig takes any whole number of bytes from 1 as SEXTOU_RUNNER_MAX_TASKS_FILE_BYTES',
  (bytes) => {
    expect(
      load({ SEXTOU_RUNNER_MAX_TASKS_FILE_BYTES: String(bytes) })
        .maxTasksFileBytes,
    ).toBe(bytes);
  },
);
