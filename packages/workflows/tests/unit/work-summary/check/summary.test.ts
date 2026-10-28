import { expect, test } from 'vitest';
import { checkSummary } from '../../../../work-summary/check/summary';

// A run that exits with `exit_code`.
function run(exit_code = 0) {
  return { command: 'pnpm test', exit_code, output: 'Tests  3 passed' };
}

// The evidence entry of `unit`, which changed behavior with a test inspected,
// one added, a red run and a verification run, changed by `fields`.
function entry(unit: string, fields: Record<string, unknown> = {}) {
  return {
    unit,
    behavior_changed: true,
    tests: {
      inspected: ['tests/a.test.ts'],
      added_or_changed: ['tests/b.test.ts'],
      used_unchanged: [],
    },
    red: run(1),
    verification: [run()],
    exception: null,
    ...fields,
  };
}

// The evidence entry of `unit`, which changed no behavior and cites nothing.
function quiet(unit: string) {
  return entry(unit, {
    behavior_changed: false,
    tests: { inspected: [], added_or_changed: [], used_unchanged: [] },
    red: null,
    verification: [],
  });
}

// A complete summary of U1, which changed behavior, and U2, which didn't,
// changed by `fields`.
function summary(fields: Record<string, unknown> = {}) {
  return {
    status: 'complete',
    changed_files: ['src/a.ts', 'tests/b.test.ts'],
    u_ids_attempted: ['U1', 'U2'],
    u_ids_completed: ['U1', 'U2'],
    verification: [run()],
    verification_evidence: [entry('U1'), quiet('U2')],
    settled_decision_conflicts: [],
    behavior_change: true,
    blockers: [],
    ...fields,
  };
}

// The reasons checkSummary refuses `value`, written as JSON, for.
function reasons(value: unknown) {
  return checkSummary(JSON.stringify(value)).reasons;
}

test('checkSummary takes a complete summary of a unit that changed behavior and one that did not', () => {
  expect(reasons(summary())).toEqual([]);
});

test('checkSummary hands back the summary it read', () => {
  expect(checkSummary(JSON.stringify(summary())).summary).toEqual(summary());
});

test('checkSummary takes a blocked summary with a blocker and a conflict', () => {
  expect(
    reasons(
      summary({
        status: 'blocked',
        u_ids_completed: ['U1'],
        blockers: ['U2 needs a decision on the schema'],
        settled_decision_conflicts: [
          {
            decision: 'KTD2',
            evidence: 'git merge-base exits 1 here',
            routing: 'blocker',
          },
          {
            decision: 'KTD7',
            evidence: 'the plan names a folder',
            routing: 'proceeded_and_flagged',
          },
        ],
      }),
    ),
  ).toEqual([]);
});

test.each([
  ['text that is not JSON', 'done'],
  ['a JSON array', '[]'],
  ['null', 'null'],
  ['a string', '"done"'],
])('checkSummary refuses %s with one reason', (_name, text) => {
  expect(checkSummary(text)).toEqual({
    reasons: ['summary is a JSON object'],
    summary: undefined,
  });
});

test('checkSummary refuses a summary with no blockers, naming the field', () => {
  const { blockers: _, ...rest } = summary();

  expect(reasons(rest)).toEqual(['blockers is missing']);
});

test.each([
  ['the top level', summary({ notes: 'x' }), 'notes'],
  [
    'an evidence entry',
    summary({
      verification_evidence: [entry('U1', { notes: 'x' }), quiet('U2')],
    }),
    'verification_evidence[0].notes',
  ],
  [
    'tests',
    summary({
      verification_evidence: [
        entry('U1', {
          tests: {
            inspected: ['tests/a.test.ts'],
            added_or_changed: ['tests/b.test.ts'],
            used_unchanged: [],
            skipped: [],
          },
        }),
        quiet('U2'),
      ],
    }),
    'verification_evidence[0].tests.skipped',
  ],
  [
    'a run',
    summary({ verification: [{ ...run(), duration: 3 }] }),
    'verification[0].duration',
  ],
  [
    'a conflict',
    summary({
      settled_decision_conflicts: [
        { decision: 'KTD2', evidence: 'x', routing: 'blocker', notes: 'x' },
      ],
    }),
    'settled_decision_conflicts[0].notes',
  ],
])(
  'checkSummary refuses a field the format does not define at %s, naming its path',
  (_name, value, path) => {
    expect(reasons(value)).toEqual([`${path} is not a field of the format`]);
  },
);

test.each([
  [
    'a status of done',
    { status: 'done' },
    'status is complete, blocked or failed',
  ],
  [
    'changed_files that is not a list',
    { changed_files: 'src/a.ts' },
    'changed_files is a list of non-empty strings',
  ],
  [
    'changed_files with an empty path',
    { changed_files: ['src/a.ts', ''] },
    'changed_files is a list of non-empty strings',
  ],
  [
    'a blocker that is blank',
    { status: 'blocked', u_ids_completed: ['U1'], blockers: ['  '] },
    'blockers is a list of non-empty strings',
  ],
  [
    'a behavior_change that is a string',
    { behavior_change: 'true' },
    'behavior_change is true or false',
  ],
  [
    'verification that is not a list',
    { verification: run() },
    'verification is a list',
  ],
  [
    'a run that is not an object',
    { verification: ['pnpm test'] },
    'verification[0] is an object',
  ],
  [
    'a run with no command',
    { verification: [{ exit_code: 0, output: '' }] },
    'verification[0].command is missing',
  ],
  [
    'a run with an empty command',
    { verification: [{ ...run(), command: '' }] },
    'verification[0].command is a non-empty string',
  ],
  [
    'a run with no output',
    { verification: [{ command: 'pnpm test', exit_code: 0 }] },
    'verification[0].output is missing',
  ],
  [
    'an exit_code of 1.5',
    { verification: [run(1.5)] },
    'verification[0].exit_code is an integer',
  ],
  [
    'an exit_code of "0"',
    { verification: [{ ...run(), exit_code: '0' }] },
    'verification[0].exit_code is an integer',
  ],
  [
    'an output of 4001 characters',
    { verification: [{ ...run(), output: 'x'.repeat(4001) }] },
    'verification[0].output is a string of at most 4000 characters',
  ],
  [
    'a conflict with an unknown routing',
    {
      settled_decision_conflicts: [
        { decision: 'KTD2', evidence: 'x', routing: 'ignored' },
      ],
    },
    'settled_decision_conflicts[0].routing is proceeded_and_flagged or blocker',
  ],
  [
    'a conflict with no decision',
    { settled_decision_conflicts: [{ evidence: 'x', routing: 'blocker' }] },
    'settled_decision_conflicts[0].decision is missing',
  ],
  [
    'settled_decision_conflicts that is not a list',
    { settled_decision_conflicts: {} },
    'settled_decision_conflicts is a list',
  ],
])('checkSummary refuses %s', (_name, fields, reason) => {
  expect(reasons(summary(fields))).toEqual([reason]);
});

test('checkSummary takes an output of 4000 characters and an empty one', () => {
  expect(
    reasons(
      summary({
        verification: [
          { ...run(), output: 'x'.repeat(4000) },
          { ...run(), output: '' },
        ],
      }),
    ),
  ).toEqual([]);
});

test('checkSummary takes a negative exit_code', () => {
  expect(
    reasons(
      summary({
        verification_evidence: [entry('U1', { red: run(-1) }), quiet('U2')],
      }),
    ),
  ).toEqual([]);
});

test.each([
  [
    'an entry that is not an object',
    [entry('U1'), 'U2'],
    ['verification_evidence[1] is an object'],
  ],
  [
    'an entry with no unit',
    [entry('U1'), { ...quiet('U2'), unit: undefined }],
    ['verification_evidence[1].unit is missing'],
  ],
  [
    'a behavior_changed that is a number',
    [entry('U1'), { ...quiet('U2'), behavior_changed: 0 }],
    ['verification_evidence[1].behavior_changed is true or false'],
  ],
  [
    'tests that is a list',
    [entry('U1', { tests: [] }), quiet('U2')],
    ['verification_evidence[0].tests is an object'],
  ],
  [
    'tests with no inspected',
    [
      entry('U1', {
        tests: { added_or_changed: ['tests/b.test.ts'], used_unchanged: [] },
      }),
      quiet('U2'),
    ],
    ['verification_evidence[0].tests.inspected is missing'],
  ],
  [
    'a red that is a string',
    [entry('U1', { red: 'failed' }), quiet('U2')],
    ['verification_evidence[0].red is an object'],
  ],
  [
    'an exception that is empty',
    [entry('U1', { exception: '' }), quiet('U2')],
    ['verification_evidence[0].exception is a non-empty string'],
  ],
])('checkSummary refuses %s', (_name, verification_evidence, expected) => {
  expect(reasons(summary({ verification_evidence }))).toEqual(expected);
});

test('checkSummary refuses a completed unit that was never tried (R9)', () => {
  expect(
    reasons(
      summary({
        u_ids_attempted: ['U1'],
        u_ids_completed: ['U1', 'U3'],
        verification_evidence: [entry('U1')],
      }),
    ),
  ).toEqual(['u_ids_completed has U3, which u_ids_attempted lacks']);
});

test('checkSummary refuses a tried unit with no evidence entry (R9)', () => {
  expect(reasons(summary({ verification_evidence: [entry('U1')] }))).toEqual([
    'verification_evidence has no entry for U2',
  ]);
});

test('checkSummary refuses an entry for a unit nobody tried (R9)', () => {
  expect(
    reasons(
      summary({
        verification_evidence: [entry('U1'), quiet('U2'), quiet('U4')],
      }),
    ),
  ).toEqual([
    'verification_evidence[2] is for U4, which u_ids_attempted lacks',
  ]);
});

test('checkSummary refuses two entries for one unit (R9)', () => {
  expect(
    reasons(
      summary({
        verification_evidence: [entry('U1'), quiet('U2'), quiet('U2')],
      }),
    ),
  ).toEqual(['verification_evidence has 2 entries for U2']);
});

test('checkSummary judges no entry count while an entry has no unit it can read (R9)', () => {
  expect(
    reasons(summary({ verification_evidence: [entry('U1'), entry('')] })),
  ).toEqual(['verification_evidence[1].unit is a non-empty string']);
});

test('checkSummary refuses a blocked summary with no blockers (AE4, R10)', () => {
  expect(
    reasons(summary({ status: 'blocked', u_ids_completed: ['U1'] })),
  ).toEqual(['status is blocked, but blockers is empty']);
});

test('checkSummary refuses a failed summary with no blockers (R10)', () => {
  expect(reasons(summary({ status: 'failed' }))).toEqual([
    'status is failed, but blockers is empty',
  ]);
});

test('checkSummary refuses a complete summary with a blocker (R10)', () => {
  expect(reasons(summary({ blockers: ['a test is flaky'] }))).toEqual([
    'status is complete, but blockers is not empty',
  ]);
});

test('checkSummary refuses a complete summary with a tried unit left uncompleted (R10)', () => {
  expect(reasons(summary({ u_ids_completed: ['U1'] }))).toEqual([
    'status is complete, but U2 was tried and not completed',
  ]);
});

test('checkSummary refuses a behavior_change of true when no entry changed behavior (R11)', () => {
  expect(
    reasons(summary({ verification_evidence: [quiet('U1'), quiet('U2')] })),
  ).toEqual(['behavior_change is true, but no entry changed behavior']);
});

test('checkSummary refuses a behavior_change of false when an entry changed behavior (R11)', () => {
  expect(reasons(summary({ behavior_change: false }))).toEqual([
    'behavior_change is false, but verification_evidence[0] changed behavior',
  ]);
});

test('checkSummary takes a behavior_change of false when no entry changed behavior (R11)', () => {
  expect(
    reasons(
      summary({
        behavior_change: false,
        verification_evidence: [quiet('U1'), quiet('U2')],
      }),
    ),
  ).toEqual([]);
});

test('checkSummary judges no behavior_change while an entry has no behavior_changed it can read (R11)', () => {
  expect(
    reasons(
      summary({
        verification_evidence: [
          quiet('U1'),
          { ...quiet('U2'), behavior_changed: 'no' },
        ],
      }),
    ),
  ).toEqual(['verification_evidence[1].behavior_changed is true or false']);
});

// The entry of U1, which changed behavior, with `tests` and `verification`.
function changed(
  tests: Record<string, string[]>,
  verification: unknown[] = [run()],
  exception: string | null = null,
) {
  return summary({
    verification_evidence: [
      entry('U1', {
        tests: {
          inspected: [],
          added_or_changed: [],
          used_unchanged: [],
          ...tests,
        },
        verification,
        exception,
      }),
      quiet('U2'),
    ],
  });
}

test('checkSummary refuses an entry that changed behavior with no test inspected (R12)', () => {
  expect(reasons(changed({ added_or_changed: ['tests/b.test.ts'] }))).toEqual([
    'verification_evidence[0] changed behavior, but tests.inspected is empty and exception is null',
  ]);
});

test('checkSummary refuses an entry that changed behavior with no test added, changed or used unchanged (R12)', () => {
  expect(reasons(changed({ inspected: ['tests/a.test.ts'] }))).toEqual([
    'verification_evidence[0] changed behavior, but tests.added_or_changed and tests.used_unchanged are empty and exception is null',
  ]);
});

test('checkSummary takes an entry that changed behavior with a test used unchanged (R12)', () => {
  expect(
    reasons(
      changed({
        inspected: ['tests/a.test.ts'],
        used_unchanged: ['tests/a.test.ts'],
      }),
    ),
  ).toEqual([]);
});

test('checkSummary refuses an entry that changed behavior with no verification run (R12)', () => {
  expect(
    reasons(
      changed(
        {
          inspected: ['tests/a.test.ts'],
          added_or_changed: ['tests/b.test.ts'],
        },
        [],
      ),
    ),
  ).toEqual([
    'verification_evidence[0] changed behavior, but verification is empty and exception is null',
  ]);
});

test('checkSummary takes an entry that changed behavior with no evidence but an exception (R12)', () => {
  expect(reasons(changed({}, [], 'only a comment changed'))).toEqual([]);
});

test('checkSummary refuses a red run that exits with 0 (AE3, R13)', () => {
  expect(
    reasons(
      summary({
        verification_evidence: [entry('U1', { red: run(0) }), quiet('U2')],
      }),
    ),
  ).toEqual([
    'verification_evidence[0].red.exit_code is 0, but a red run fails',
  ]);
});

test("checkSummary refuses a completed unit's verification run that exits with 1 (R14)", () => {
  expect(
    reasons(
      summary({
        verification_evidence: [
          entry('U1', { verification: [run(), run(1)] }),
          quiet('U2'),
        ],
      }),
    ),
  ).toEqual([
    'verification_evidence[0].verification[1].exit_code is 1, but U1 is completed',
  ]);
});

test('checkSummary takes a verification run that exits with 1 for a unit tried and not completed (R14)', () => {
  expect(
    reasons(
      summary({
        status: 'failed',
        u_ids_completed: ['U2'],
        blockers: ['U1 does not pass'],
        verification_evidence: [
          entry('U1', { verification: [run(1)] }),
          quiet('U2'),
        ],
      }),
    ),
  ).toEqual([]);
});

test('checkSummary refuses a summary run that exits with 1 when the status is complete (R14)', () => {
  expect(reasons(summary({ verification: [run(), run(1)] }))).toEqual([
    'verification[1].exit_code is 1, but status is complete',
  ]);
});

test('checkSummary takes a summary run that exits with 1 when the status is blocked (R14)', () => {
  expect(
    reasons(
      summary({
        status: 'blocked',
        blockers: ['the suite fails'],
        verification: [run(1)],
      }),
    ),
  ).toEqual([]);
});

test('checkSummary gives every reason in one answer (AE6, R20)', () => {
  const { blockers: _, ...rest } = summary({
    u_ids_completed: ['U1', 'U2', 'U3'],
  });

  expect(reasons(rest)).toEqual([
    'blockers is missing',
    'u_ids_completed has U3, which u_ids_attempted lacks',
  ]);
});

test("checkSummary still judges the rest of a summary whose entry's red has a malformed exit_code", () => {
  expect(
    reasons(
      summary({
        u_ids_completed: ['U1', 'U2', 'U3'],
        verification_evidence: [
          entry('U1', { red: { ...run(), exit_code: 0.5 } }),
          entry('U2', { red: run(0) }),
        ],
      }),
    ),
  ).toEqual([
    'verification_evidence[0].red.exit_code is an integer',
    'u_ids_completed has U3, which u_ids_attempted lacks',
    'verification_evidence[1].red.exit_code is 0, but a red run fails',
  ]);
});

test('checkSummary judges no rule on a field that failed the form', () => {
  expect(
    reasons(
      summary({
        status: 'finished',
        u_ids_attempted: 'U1',
        behavior_change: null,
        verification_evidence: {},
      }),
    ),
  ).toEqual([
    'status is complete, blocked or failed',
    'u_ids_attempted is a list of non-empty strings',
    'verification_evidence is a list',
    'behavior_change is true or false',
  ]);
});
