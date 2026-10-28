import { expect, test } from 'vitest';
import {
  type Branch,
  checkBranch,
  planUnits,
} from '../../../../work-summary/check/branch';
import type { Checked, Summary } from '../../../../work-summary/check/summary';

const plan = 'docs/plan.md';

// A branch whose first commit adds the plan, then one commit per unit, U1
// adding src/a.ts and its test, U2 changing src/b.ts, changed by `fields`.
function branch(fields: Partial<Branch> = {}): Branch {
  return {
    changed: [plan, 'src/a.ts', 'src/b.ts', 'tests/a.test.ts'],
    commits: [
      { sha: 'aaaaaaa', subject: 'docs: the plan', units: [], paths: [plan] },
      {
        sha: 'bbbbbbb',
        subject: 'feat: a',
        units: ['U1'],
        paths: ['src/a.ts', 'tests/a.test.ts'],
      },
      {
        sha: 'ccccccc',
        subject: 'feat: b',
        units: ['U2'],
        paths: ['src/b.ts'],
      },
    ],
    tree: [plan, 'src/a.ts', 'src/b.ts', 'tests/a.test.ts', 'tests/b.test.ts'],
    ...fields,
  };
}

// The evidence entry of `unit`, with `tests`.
function entry(
  unit: string,
  tests: Partial<Summary['verification_evidence'][number]['tests']> = {},
) {
  return {
    unit,
    behavior_changed: true,
    tests: {
      inspected: ['tests/b.test.ts'],
      added_or_changed: ['tests/a.test.ts'],
      used_unchanged: [],
      ...tests,
    },
    red: null,
    verification: [],
    exception: null,
  };
}

// A summary of U1 and U2 that matches branch(), changed by `fields`.
function summary(fields: Checked<Summary> = {}): Checked<Summary> {
  return {
    status: 'complete',
    changed_files: ['src/a.ts', 'src/b.ts', 'tests/a.test.ts'],
    u_ids_attempted: ['U1', 'U2'],
    u_ids_completed: ['U1', 'U2'],
    verification: [],
    verification_evidence: [entry('U1'), entry('U2')],
    settled_decision_conflicts: [],
    behavior_change: true,
    blockers: [],
    ...fields,
  };
}

// The reasons checkBranch refuses `value` for, against `facts`, a plan with
// U1 to U3 and the plan's path ignored.
function reasons(value: Checked<Summary>, facts: Branch = branch()) {
  return checkBranch(value, facts, ['U1', 'U2', 'U3'], [plan]);
}

test('checkBranch takes a summary whose changed_files is the diff, ignored paths left out (AE1)', () => {
  expect(reasons(summary())).toEqual([]);
});

test('checkBranch refuses changed_files that lacks a file the branch changed, naming it (AE1, R15)', () => {
  expect(reasons(summary({ changed_files: ['tests/a.test.ts'] }))).toEqual([
    'changed_files lacks src/a.ts, which the branch changed',
    'changed_files lacks src/b.ts, which the branch changed',
  ]);
});

test('checkBranch refuses changed_files that has a file the branch did not change, naming it (R15)', () => {
  expect(
    reasons(
      summary({
        changed_files: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'tests/a.test.ts'],
      }),
    ),
  ).toEqual(['changed_files has src/c.ts, which the branch did not change']);
});

test('checkBranch takes an ignored path that changed_files lists (R15)', () => {
  expect(
    reasons(
      summary({
        changed_files: [plan, 'src/a.ts', 'src/b.ts', 'tests/a.test.ts'],
      }),
    ),
  ).toEqual([]);
});

test('checkBranch takes an ignored path that changed_files lists though the branch did not change it (R15)', () => {
  const facts = branch({
    changed: ['src/a.ts', 'src/b.ts', 'tests/a.test.ts'],
    commits: branch().commits.slice(1),
  });

  expect(
    reasons(
      summary({
        changed_files: [plan, 'src/a.ts', 'src/b.ts', 'tests/a.test.ts'],
      }),
      facts,
    ),
  ).toEqual([]);
});

test('checkBranch asks for a renamed file under its old path and its new one (R15)', () => {
  const facts = branch({
    changed: [
      plan,
      'src/a.ts',
      'src/b.ts',
      'src/old.ts',
      'src/new.ts',
      'tests/a.test.ts',
    ],
  });

  expect(reasons(summary(), facts)).toEqual([
    'changed_files lacks src/old.ts, which the branch changed',
    'changed_files lacks src/new.ts, which the branch changed',
  ]);
});

test('checkBranch judges no changed_files that failed the form', () => {
  expect(reasons(summary({ changed_files: undefined }))).toEqual([]);
});

test('checkBranch refuses a tried unit the plan lacks (R16)', () => {
  expect(
    reasons(
      summary({
        status: 'blocked',
        u_ids_attempted: ['U1', 'U2', 'U4'],
        verification_evidence: [entry('U1'), entry('U2'), entry('U4')],
        blockers: ['U4 is not in the plan'],
      }),
    ),
  ).toEqual(['u_ids_attempted has U4, which the plan lacks']);
});

test('checkBranch refuses a completed unit the plan lacks (R16)', () => {
  expect(reasons(summary({ u_ids_completed: ['U1', 'U2', 'U4'] }))).toEqual([
    'u_ids_completed has U4, which the plan lacks',
    'U4 is completed, but no commit names it in a Units: trailer',
  ]);
});

test('checkBranch refuses a completed unit no commit names (R17)', () => {
  expect(
    reasons(
      summary({
        u_ids_attempted: ['U1', 'U2', 'U3'],
        u_ids_completed: ['U1', 'U2', 'U3'],
        verification_evidence: [entry('U1'), entry('U2'), entry('U3')],
      }),
    ),
  ).toEqual(['U3 is completed, but no commit names it in a Units: trailer']);
});

test('checkBranch takes a tried unit no commit names, left uncompleted (R17)', () => {
  expect(
    reasons(
      summary({
        status: 'blocked',
        u_ids_attempted: ['U1', 'U2', 'U3'],
        verification_evidence: [entry('U1'), entry('U2'), entry('U3')],
        blockers: ['U3 waits on a decision'],
      }),
    ),
  ).toEqual([]);
});

test('checkBranch takes a unit named by a commit that names several (R17)', () => {
  const facts = branch({
    commits: [
      branch().commits[0],
      {
        sha: 'bbbbbbb',
        subject: 'feat: a and b',
        units: ['U1', 'U2'],
        paths: ['src/a.ts', 'src/b.ts', 'tests/a.test.ts'],
      },
    ],
  });

  expect(reasons(summary(), facts)).toEqual([]);
});

test('checkBranch refuses a commit with no trailer that changes a source file, naming it (R17)', () => {
  const facts = branch({
    commits: [
      ...branch().commits,
      { sha: 'ddddddd', subject: 'fix: b', units: [], paths: ['src/b.ts'] },
    ],
  });

  expect(reasons(summary(), facts)).toEqual([
    'commit ddddddd (fix: b) names no unit of the plan in a Units: trailer',
  ]);
});

test('checkBranch takes a commit with no trailer that changes only the ignored plan (AE2, R17)', () => {
  expect(reasons(summary())).toEqual([]);
});

test('checkBranch refuses a commit with no trailer that changes the ignored plan and a source file (AE2, R17)', () => {
  const [first, ...rest] = branch().commits;
  const facts = branch({
    commits: [{ ...first, paths: [plan, 'src/b.ts'] }, ...rest],
  });

  expect(reasons(summary(), facts)).toEqual([
    'commit aaaaaaa (docs: the plan) names no unit of the plan in a Units: trailer',
  ]);
});

test('checkBranch takes a commit that changes no path, with no trailer (R17)', () => {
  const facts = branch({
    commits: [
      ...branch().commits,
      { sha: 'ddddddd', subject: 'chore: empty', units: [], paths: [] },
    ],
  });

  expect(reasons(summary(), facts)).toEqual([]);
});

test('checkBranch refuses a commit whose trailer names a unit the plan lacks (R17)', () => {
  const facts = branch({
    commits: [
      ...branch().commits,
      {
        sha: 'ddddddd',
        subject: 'feat: d',
        units: ['U2', 'U9'],
        paths: ['src/b.ts'],
      },
    ],
  });

  expect(reasons(summary(), facts)).toEqual([
    'commit ddddddd (feat: d) names U9, which the plan lacks',
  ]);
});

test('checkBranch refuses a commit whose trailer names only units the plan lacks once per unit (R17)', () => {
  const facts = branch({
    commits: [
      ...branch().commits,
      {
        sha: 'ddddddd',
        subject: 'feat: d',
        units: ['U9'],
        paths: ['src/b.ts'],
      },
    ],
  });

  expect(reasons(summary(), facts)).toEqual([
    'commit ddddddd (feat: d) names U9, which the plan lacks',
  ]);
});

test('checkBranch refuses a merge commit with no trailer like any other (R17)', () => {
  const facts = branch({
    changed: [...branch().changed, 'src/main.ts'],
    commits: [
      ...branch().commits,
      {
        sha: 'eeeeeee',
        subject: "Merge branch 'main'",
        units: [],
        paths: ['src/main.ts'],
      },
    ],
  });

  expect(
    reasons(
      summary({
        changed_files: [
          'src/a.ts',
          'src/b.ts',
          'src/main.ts',
          'tests/a.test.ts',
        ],
      }),
      facts,
    ),
  ).toEqual([
    "commit eeeeeee (Merge branch 'main') names no unit of the plan in a Units: trailer",
  ]);
});

test('checkBranch refuses a test inspected that HEAD lacks, naming it (R18)', () => {
  expect(
    reasons(
      summary({
        verification_evidence: [
          entry('U1', { inspected: ['tests/gone.test.ts'] }),
          entry('U2'),
        ],
      }),
    ),
  ).toEqual([
    'verification_evidence[0].tests.inspected has tests/gone.test.ts, which HEAD lacks',
  ]);
});

test('checkBranch refuses a test used unchanged that HEAD lacks, naming it (R18)', () => {
  expect(
    reasons(
      summary({
        verification_evidence: [
          entry('U1'),
          entry('U2', { used_unchanged: ['tests/gone.test.ts'] }),
        ],
      }),
    ),
  ).toEqual([
    'verification_evidence[1].tests.used_unchanged has tests/gone.test.ts, which HEAD lacks',
  ]);
});

test('checkBranch takes a test used unchanged that HEAD has (R18)', () => {
  expect(
    reasons(
      summary({
        verification_evidence: [
          entry('U1'),
          entry('U2', { used_unchanged: ['tests/b.test.ts'] }),
        ],
      }),
    ),
  ).toEqual([]);
});

test('checkBranch refuses a test added or changed that the diff does not hold, naming it (AE5, R18)', () => {
  expect(
    reasons(
      summary({
        verification_evidence: [
          entry('U1'),
          entry('U2', { added_or_changed: ['tests/b.test.ts'] }),
        ],
      }),
    ),
  ).toEqual([
    'verification_evidence[1].tests.added_or_changed has tests/b.test.ts, which the branch did not change',
  ]);
});

test('checkBranch judges no entry, nor tests, that failed the form (R18)', () => {
  expect(
    reasons(
      summary({
        verification_evidence: [
          undefined,
          { ...entry('U2'), tests: undefined },
          { ...entry('U3'), tests: { inspected: undefined } },
        ],
      }),
    ),
  ).toEqual([]);
});

test('checkBranch judges no unit lists that failed the form (R16, R17)', () => {
  expect(
    reasons(
      summary({ u_ids_attempted: undefined, u_ids_completed: undefined }),
    ),
  ).toEqual([]);
});

test("planUnits reads the U-IDs of the plan's unit headings, gaps kept", () => {
  expect(
    planUnits(
      [
        '# A plan',
        '## Implementation Units',
        '### U1. The first',
        'text',
        '### U3. The third',
        '### U10. The tenth',
      ].join('\n'),
    ),
  ).toEqual(['U1', 'U3', 'U10']);
});

test.each([
  ['a fenced block of backticks', '```'],
  ['a fenced block of tildes', '~~~'],
  ['a fenced block with a language', '```markdown'],
])('planUnits leaves out a heading inside %s', (_name, fence) => {
  expect(
    planUnits(
      [
        '### U1. The first',
        fence,
        '### U2. An example',
        fence.slice(0, 3),
        '### U3. The third',
      ].join('\n'),
    ),
  ).toEqual(['U1', 'U3']);
});

test('planUnits leaves a backtick fence open until backticks close it', () => {
  expect(
    planUnits(
      ['```', '~~~', '### U2. Inside', '```', '### U3. Out'].join('\n'),
    ),
  ).toEqual(['U3']);
});

test.each([
  ['prose', 'U1 lands first, then U2.'],
  ['a table', '| U1 | the first |'],
  ['a heading of another level', '## U1. The first'],
  ['a heading with no period', '### U1 The first'],
  ['a heading with no space after the period', '### U1.The first'],
  ['a heading of another prefix', '### R1. A requirement'],
])('planUnits takes no unit from %s', (_name, line) => {
  expect(planUnits(line)).toEqual([]);
});

test('planUnits reads no unit from a plan with no unit heading', () => {
  expect(planUnits('# A plan\n\nNothing to build.')).toEqual([]);
});
