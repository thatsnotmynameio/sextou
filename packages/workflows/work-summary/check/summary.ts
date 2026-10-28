// The work summary: what the work task (#139) leaves for the validate task,
// one JSON object with exactly the fields of Summary. A field these types
// don't define is refused, at any depth.

// A command the work ran.
export interface Run {
  // The command as it ran, such as `pnpm --filter @sextou/workflows test:unit`.
  command: string;
  // Its exit code, an integer.
  exit_code: number;
  // An excerpt of what it wrote: the lines that show the result, at most
  // 4,000 characters, and possibly empty.
  output: string;
}

// The tests a unit's evidence cites, each a path in the repository.
export interface Tests {
  // The tests read to learn how the code is tested. Each exists at HEAD.
  inspected: string[];
  // The tests the unit added or changed. Each is in the branch's diff.
  added_or_changed: string[];
  // The tests that prove the unit as they were. Each exists at HEAD.
  used_unchanged: string[];
}

// How the work proved one unit it tried.
export interface Evidence {
  // The unit's U-ID in the plan, such as U3.
  unit: string;
  // Whether the unit changed what the code does.
  behavior_changed: boolean;
  tests: Tests;
  // The run that failed before the change, or null when none applies.
  red: Run | null;
  // The runs that verify the unit as it stands.
  verification: Run[];
  // Why the unit has less evidence than a behavior change asks for, or null.
  exception: string | null;
}

// A settled decision of the plan that the work found evidence against.
export interface Conflict {
  // The decision, as the plan names it, such as KTD2.
  decision: string;
  // What the work found.
  evidence: string;
  // Whether the work went on and flagged it, or stopped on it.
  routing: 'proceeded_and_flagged' | 'blocker';
}

// What the work did on the whole branch, from the base to HEAD: on recovery,
// the runs before it too.
export interface Summary {
  status: 'complete' | 'blocked' | 'failed';
  // Every file the branch changed, each a path in the repository: a renamed
  // file under its old path and its new one, a deleted file too.
  changed_files: string[];
  // The plan's units the work tried, and those it completed.
  u_ids_attempted: string[];
  u_ids_completed: string[];
  // The final runs over the whole branch.
  verification: Run[];
  // One entry per unit in u_ids_attempted.
  verification_evidence: Evidence[];
  settled_decision_conflicts: Conflict[];
  // Whether some unit changed behavior.
  behavior_change: boolean;
  // Why the work stopped: none when complete, at least one otherwise.
  blockers: string[];
}

// A value as the form check left it: a field that failed it is undefined, and
// so is an item of a list of objects. A list of strings fails whole.
export type Checked<T> = T extends string[]
  ? T
  : T extends (infer Item)[]
    ? (Checked<Item> | undefined)[]
    : T extends object
      ? { [Key in keyof T]?: Checked<T[Key]> }
      : T;

export interface CheckSummary {
  // Every reason the summary breaks the format or contradicts itself.
  reasons: string[];
  // The summary, or undefined when the text isn't a JSON object.
  summary: Checked<Summary> | undefined;
}

// The most a run's output holds.
const maxOutput = 4000;

// Reads a summary's text and returns every reason it breaks the format or
// contradicts itself, with the summary as the form check left it, so the
// branch's judge takes what it can. Each rule runs unless a field it reads
// failed the form, so no reason rests on a malformed field.
export function checkSummary(text: string): CheckSummary {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { reasons: ['summary is a JSON object'], summary: undefined };
  }
  if (!isObject(value)) {
    return { reasons: ['summary is a JSON object'], summary: undefined };
  }
  const reasons: string[] = [];
  const summary = readSummary(value, '', reasons) as Checked<Summary>;
  cohere(summary, reasons);
  return { reasons, summary };
}

// A reader checks a value at a path of the summary, adds each reason it
// breaks the form to `reasons`, and returns it as the form check leaves it,
// undefined when it failed.
type Reader<T> = (
  value: unknown,
  at: string,
  reasons: string[],
) => T | undefined;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

// `value` when `ok`, else the reason: missing, or not what `expected` says.
function check<T>(
  ok: boolean,
  value: unknown,
  at: string,
  expected: string,
  reasons: string[],
): T | undefined {
  if (ok) {
    return value as T;
  }
  reasons.push(
    value === undefined ? `${at} is missing` : `${at} is ${expected}`,
  );
  return undefined;
}

const text: Reader<string> = (value, at, reasons) =>
  check(isText(value), value, at, 'a non-empty string', reasons);

const texts: Reader<string[]> = (value, at, reasons) =>
  check(
    Array.isArray(value) && value.every(isText),
    value,
    at,
    'a list of non-empty strings',
    reasons,
  );

const boolean: Reader<boolean> = (value, at, reasons) =>
  check(typeof value === 'boolean', value, at, 'true or false', reasons);

const integer: Reader<number> = (value, at, reasons) =>
  check(Number.isInteger(value), value, at, 'an integer', reasons);

const output: Reader<string> = (value, at, reasons) =>
  check(
    typeof value === 'string' && value.length <= maxOutput,
    value,
    at,
    `a string of at most ${maxOutput} characters`,
    reasons,
  );

function oneOf<T extends string>(...values: T[]): Reader<T> {
  return (value, at, reasons) =>
    check(
      values.includes(value as T),
      value,
      at,
      values.length === 2
        ? values.join(' or ')
        : `${values.slice(0, -1).join(', ')} or ${values.at(-1)}`,
      reasons,
    );
}

function orNull<T>(read: Reader<T>): Reader<T | null> {
  return (value, at, reasons) =>
    value === null ? null : read(value, at, reasons);
}

function list<T>(read: Reader<T>): Reader<(T | undefined)[]> {
  return (value, at, reasons) =>
    Array.isArray(value)
      ? value.map((item, index) => read(item, `${at}[${index}]`, reasons))
      : check(false, value, at, 'a list', reasons);
}

// An object with exactly `fields`, each read by its reader.
function object<T>(fields: { [Key in keyof T]-?: Reader<T[Key]> }): Reader<T> {
  return (value, at, reasons) => {
    if (!isObject(value)) {
      return check(false, value, at, 'an object', reasons);
    }
    const path = (key: string) => (at === '' ? key : `${at}.${key}`);
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(fields, key)) {
        reasons.push(`${path(key)} is not a field of the format`);
      }
    }
    return Object.fromEntries(
      Object.entries<Reader<unknown>>(fields).map(([key, read]) => [
        key,
        read(value[key], path(key), reasons),
      ]),
    ) as T;
  };
}

const readRun = object<Checked<Run>>({
  command: text,
  exit_code: integer,
  output,
});

const readSummary = object<Checked<Summary>>({
  status: oneOf('complete', 'blocked', 'failed'),
  changed_files: texts,
  u_ids_attempted: texts,
  u_ids_completed: texts,
  verification: list(readRun),
  verification_evidence: list(
    object<Checked<Evidence>>({
      unit: text,
      behavior_changed: boolean,
      tests: object<Checked<Tests>>({
        inspected: texts,
        added_or_changed: texts,
        used_unchanged: texts,
      }),
      red: orNull(readRun),
      verification: list(readRun),
      exception: orNull(text),
    }),
  ),
  settled_decision_conflicts: list(
    object<Checked<Conflict>>({
      decision: text,
      evidence: text,
      routing: oneOf('proceeded_and_flagged', 'blocker'),
    }),
  ),
  behavior_change: boolean,
  blockers: texts,
});

// The rules between the summary's fields, R9 to R14.
function cohere(summary: Checked<Summary>, reasons: string[]) {
  const {
    status,
    u_ids_attempted: attempted,
    u_ids_completed: completed,
    verification_evidence: entries,
    behavior_change: behaviorChange,
    blockers,
  } = summary;

  // R9: every completed unit was tried, and every tried unit has exactly one
  // entry.
  if (attempted !== undefined && completed !== undefined) {
    for (const unit of completed) {
      if (!attempted.includes(unit)) {
        reasons.push(
          `u_ids_completed has ${unit}, which u_ids_attempted lacks`,
        );
      }
    }
  }
  if (
    attempted !== undefined &&
    entries?.every((entry) => entry?.unit !== undefined)
  ) {
    const units = entries.map((entry) => entry?.unit as string);
    for (const unit of new Set(attempted)) {
      if (!units.includes(unit)) {
        reasons.push(`verification_evidence has no entry for ${unit}`);
      }
    }
    units.forEach((unit, index) => {
      if (!attempted.includes(unit)) {
        reasons.push(
          `verification_evidence[${index}] is for ${unit}, which u_ids_attempted lacks`,
        );
      }
    });
    for (const unit of new Set(units)) {
      const count = units.filter((other) => other === unit).length;
      if (count > 1) {
        reasons.push(`verification_evidence has ${count} entries for ${unit}`);
      }
    }
  }

  // R10: a complete summary completed what it tried and has no blocker; any
  // other has one.
  if (status === 'complete') {
    if (blockers !== undefined && blockers.length > 0) {
      reasons.push('status is complete, but blockers is not empty');
    }
    if (attempted !== undefined && completed !== undefined) {
      for (const unit of attempted) {
        if (!completed.includes(unit)) {
          reasons.push(
            `status is complete, but ${unit} was tried and not completed`,
          );
        }
      }
    }
  } else if (status !== undefined && blockers?.length === 0) {
    reasons.push(`status is ${status}, but blockers is empty`);
  }

  // R11: behavior_change says whether some entry changed behavior.
  if (
    behaviorChange !== undefined &&
    entries?.every((entry) => entry?.behavior_changed !== undefined)
  ) {
    const changed = entries.findIndex((entry) => entry?.behavior_changed);
    if (behaviorChange && changed === -1) {
      reasons.push('behavior_change is true, but no entry changed behavior');
    }
    if (!behaviorChange && changed !== -1) {
      reasons.push(
        `behavior_change is false, but verification_evidence[${changed}] changed behavior`,
      );
    }
  }

  entries?.forEach((entry, index) => {
    if (entry === undefined) {
      return;
    }
    const at = `verification_evidence[${index}]`;

    // R12: an entry that changed behavior cites a test inspected, a test
    // added, changed or used unchanged, and a verification run, or says why
    // not.
    if (entry.behavior_changed === true && entry.exception === null) {
      const lacks = (what: string) =>
        reasons.push(
          `${at} changed behavior, but ${what} empty and exception is null`,
        );
      const tests = entry.tests;
      if (tests?.inspected?.length === 0) {
        lacks('tests.inspected is');
      }
      if (
        tests?.added_or_changed?.length === 0 &&
        tests.used_unchanged?.length === 0
      ) {
        lacks('tests.added_or_changed and tests.used_unchanged are');
      }
      if (entry.verification?.length === 0) {
        lacks('verification is');
      }
    }

    // R13: a red run fails.
    if (entry.red?.exit_code === 0) {
      reasons.push(`${at}.red.exit_code is 0, but a red run fails`);
    }

    // R14: a completed unit's verification passes.
    const { unit } = entry;
    if (unit !== undefined && completed?.includes(unit)) {
      entry.verification?.forEach((run, runIndex) => {
        if (run?.exit_code !== undefined && run.exit_code !== 0) {
          reasons.push(
            `${at}.verification[${runIndex}].exit_code is ${run.exit_code}, but ${unit} is completed`,
          );
        }
      });
    }
  });

  // R14: a complete summary's own runs pass.
  if (status === 'complete') {
    summary.verification?.forEach((run, index) => {
      if (run?.exit_code !== undefined && run.exit_code !== 0) {
        reasons.push(
          `verification[${index}].exit_code is ${run.exit_code}, but status is complete`,
        );
      }
    });
  }
}
