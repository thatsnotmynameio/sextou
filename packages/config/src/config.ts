// A parser of one variable's value: the name is the variable's, for the
// error it throws on an invalid value.
export type Parse<T> = (value: string, name: string) => T;

// Reads a variable from env: its value parsed, or the fallback's when it is
// unset. An empty value is set, so the parser decides whether it is valid.
export function reader(env: Record<string, string | undefined>) {
  return <T>(name: string, parse: Parse<T>, fallback: () => T): T => {
    const value = env[name];
    return value === undefined ? fallback() : parse(value, name);
  };
}

// The error for an invalid value, naming the variable and what it expects.
export function invalid(name: string, value: string, expected: string) {
  return new Error(
    `Invalid ${name}: ${JSON.stringify(value)} (expected ${expected})`,
  );
}

// Only digits, from 1 to max.
export function parseCount(
  value: string,
  name: string,
  max: number,
  expected: string,
): number {
  const count = Number(value);
  if (!/^\d+$/.test(value) || count === 0 || count > max) {
    throw invalid(name, value, expected);
  }
  return count;
}

// Up to the longest delay setTimeout takes: a longer one fires after 1 ms,
// which would turn a timeout or an interval into one that fires nonstop.
export function parseTimeout(value: string, name: string): number {
  return parseCount(
    value,
    name,
    2147483647,
    'a whole number of milliseconds from 1 to 2147483647',
  );
}

export function parseBoolean(value: string, name: string): boolean {
  if (value !== 'true' && value !== 'false') {
    throw invalid(name, value, 'true or false');
  }
  return value === 'true';
}

// A parser that takes only one of values, as written.
export function parseOneOf<const T extends string>(
  values: readonly T[],
): Parse<T> {
  return (value, name) => {
    const found = values.find((candidate) => candidate === value);
    if (found === undefined) {
      throw invalid(name, value, `one of ${values.join(', ')}`);
    }
    return found;
  };
}
