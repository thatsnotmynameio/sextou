import { fc, test } from '@fast-check/vitest';
import { isAbsolute, resolve, sep } from 'node:path';
import { expect } from 'vitest';
import {
  insideWorkspace,
  readBin,
  readContext,
  readTimeout,
} from '../../../shared/settings';

// The experiment's properties of the shared settings.

const runs = { numRuns: Number(process.env.PROPERTY_RUNS ?? 100) };

// A name a folder may have: no /, no NUL, neither . nor ..
const name = fc
  .string({ unit: 'binary', minLength: 1, maxLength: 8 })
  .filter((part) => !/[/\0]/.test(part) && part !== '.' && part !== '..');
const workspace = fc
  .array(name, { minLength: 1, maxLength: 4 })
  .map((parts) => `/${parts.join('/')}`);
// A path built from names, ., .. and slashes, relative or absolute.
const path = fc
  .array(fc.oneof(name, fc.constantFrom('.', '..', '', '\0')), {
    maxLength: 8,
  })
  .chain((parts) =>
    fc.boolean().map((absolute) => (absolute ? '/' : '') + parts.join('/')),
  );

test.prop([workspace, fc.oneof(path, fc.string({ unit: 'binary' }))], runs)(
  'insideWorkspace answers the workspace or a path below it, or undefined',
  (root, given) => {
    const destination = insideWorkspace(root, given);
    if (destination !== undefined) {
      expect(destination === root || destination.startsWith(root + sep)).toBe(
        true,
      );
    }
  },
);

test.prop([workspace, path], runs)(
  'insideWorkspace answers where the path resolves when it stays inside the workspace and holds no NUL',
  (root, given) => {
    const resolved = resolve(root, given);
    const inside =
      !given.includes('\0') &&
      (resolved === root || resolved.startsWith(root + sep));
    expect(insideWorkspace(root, given)).toBe(inside ? resolved : undefined);
  },
);

test.prop([fc.integer({ min: 1, max: 2147483647 }), fc.nat()], runs)(
  'readTimeout reads any whole number of milliseconds a timer takes',
  (ms, fallback) => {
    expect(readTimeout(String(ms), fallback)).toBe(ms);
  },
);

test.prop([fc.string({ unit: 'binary' }), fc.nat()], runs)(
  'readTimeout answers a number only for the canonical digits of one a timer takes',
  (value, fallback) => {
    const ms = readTimeout(value, fallback);
    if (ms !== undefined) {
      expect(String(ms)).toBe(value);
      expect(ms >= 1 && ms <= 2147483647).toBe(true);
    }
  },
);

test.prop([fc.string({ unit: 'binary' }), fc.string({ minLength: 1 })], runs)(
  'readBin refuses only a relative path, and answers any other value as given',
  (value, fallback) => {
    const relativePath = value.includes('/') && !isAbsolute(value);
    expect(readBin(value, fallback)).toBe(
      value === '' ? fallback : relativePath ? undefined : value,
    );
  },
);

test.prop([fc.dictionary(fc.string(), fc.jsonValue()), workspace], runs)(
  'readContext reads back the fields of any JSON object',
  (fields, root) => {
    expect(readContext(JSON.stringify(fields), root)).toEqual({
      ok: true,
      fields: JSON.parse(JSON.stringify(fields)),
    });
  },
);

test.prop(
  [
    fc
      .jsonValue()
      .filter(
        (value) =>
          typeof value !== 'object' || value === null || Array.isArray(value),
      ),
    workspace,
  ],
  runs,
)('readContext refuses any JSON that is not an object', (value, root) => {
  expect(readContext(JSON.stringify(value), root)).toEqual({
    ok: false,
    reason: 'context is a JSON object',
  });
});
