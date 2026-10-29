import { fc, test } from '@fast-check/vitest';
import { expect } from 'vitest';
import {
  invalid,
  parseBoolean,
  parseCount,
  parseOneOf,
  parseTimeout,
  reader,
} from '../../src/config';

// The experiment's properties of the parsers: each one over any string, with
// an oracle written apart from the code.

const numRuns = Number(process.env.CONFIG_PROPERTY_RUNS ?? 100);

// Strings near what a count looks like, and any string at all.
const countLike = fc.oneof(
  fc.stringMatching(/^\d{1,20}$/),
  fc.integer().map(String),
  fc.double().map(String),
  fc.stringMatching(/^[\s+-]?\d{1,4}[\s.e]?\d{0,3}$/),
  fc.string(),
  fc.string({ unit: 'binary' }),
);

// The oracle: only ASCII digits, and their value from 1 to max.
function count(value: string, max: number) {
  if (value === '' || [...value].some((c) => c < '0' || c > '9')) {
    return null;
  }
  const big = BigInt(value);
  return big >= 1n && big <= BigInt(max) ? Number(big) : null;
}

test.prop([countLike, fc.integer({ min: 1, max: 2 ** 31 }), fc.string()], {
  numRuns,
})(
  'parseCount takes exactly the digit strings from 1 to max, and names the variable otherwise',
  (value, max, name) => {
    const expected = count(value, max);
    if (expected === null) {
      expect(() => parseCount(value, name, max, 'a count')).toThrow(
        invalid(name, value, 'a count').message,
      );
    } else {
      expect(parseCount(value, name, max, 'a count')).toBe(expected);
    }
  },
);

test.prop([countLike], { numRuns })(
  'parseTimeout takes exactly the digit strings from 1 to 2147483647',
  (value) => {
    const expected = count(value, 2_147_483_647);
    if (expected === null) {
      expect(() => parseTimeout(value, 'SEXTOU_TIMEOUT_MS')).toThrow(
        'Invalid SEXTOU_TIMEOUT_MS',
      );
    } else {
      expect(parseTimeout(value, 'SEXTOU_TIMEOUT_MS')).toBe(expected);
    }
  },
);

test.prop(
  [
    fc.oneof(
      fc.constantFrom(
        'true',
        'false',
        'TRUE',
        ' true',
        'false\n',
        '1',
        '0',
        '',
      ),
      fc.string(),
    ),
  ],
  {
    numRuns,
  },
)('parseBoolean takes only true and false, as written', (value) => {
  if (value === 'true' || value === 'false') {
    expect(parseBoolean(value, 'SEXTOU_DEV')).toBe(value === 'true');
  } else {
    expect(() => parseBoolean(value, 'SEXTOU_DEV')).toThrow(
      invalid('SEXTOU_DEV', value, 'true or false').message,
    );
  }
});

const values = fc.uniqueArray(fc.string(), { minLength: 1, maxLength: 6 });

test.prop([values, fc.string(), fc.nat()], { numRuns })(
  'parseOneOf takes a value only when it is one of the values, as written',
  (list, other, at) => {
    const parse = parseOneOf(list);
    const listed = list[at % list.length];
    expect(parse(listed, 'SEXTOU_MODE')).toBe(listed);
    if (!list.includes(other)) {
      expect(() => parse(other, 'SEXTOU_MODE')).toThrow(
        invalid('SEXTOU_MODE', other, `one of ${list.join(', ')}`).message,
      );
    }
  },
);

const env = fc.dictionary(
  fc.string(),
  fc.option(fc.string(), { nil: undefined }),
);

test.prop([env, fc.string()], { numRuns })(
  'reader parses a set variable with its name and falls back for an unset one',
  (variables, name) => {
    const read = reader(variables);
    const value = Object.hasOwn(variables, name) ? variables[name] : undefined;
    expect(
      read(
        name,
        (parsed, named) => ({ parsed, named }),
        () => ({ parsed: 'fallback', named: '' }),
      ),
    ).toEqual(
      value === undefined
        ? { parsed: 'fallback', named: '' }
        : { parsed: value, named: name },
    );
  },
);

test.prop([fc.string(), fc.string({ unit: 'binary' }), fc.string()], {
  numRuns,
})(
  'invalid names the variable and quotes the value so it reads back',
  (name, value, expected) => {
    const { message } = invalid(name, value, expected);
    const prefix = `Invalid ${name}: `;
    const suffix = ` (expected ${expected})`;
    expect(message.startsWith(prefix)).toBe(true);
    expect(message.endsWith(suffix)).toBe(true);
    expect(JSON.parse(message.slice(prefix.length, -suffix.length))).toBe(
      value,
    );
  },
);
