import { expect, test } from 'vitest';
import {
  filesBelowFloor,
  formatVerdict,
  type ReportFiles,
} from './mutation-floor.ts';

type Mutant = ReportFiles[string]['mutants'][number];

// A mutant of the given status on a line of the file.
function mutant(
  id: string,
  status: Mutant['status'],
  line = 1,
  mutatorName = 'ConditionalExpression',
): Mutant {
  return {
    id,
    mutatorName,
    status,
    location: { start: { line, column: 1 }, end: { line, column: 10 } },
  };
}

function file(mutants: Mutant[]): ReportFiles[string] {
  return { language: 'typescript', source: 'export {};\n', mutants };
}

function killed(count: number, prefix: string): Mutant[] {
  return Array.from({ length: count }, (_, index) =>
    mutant(`${prefix}${index}`, 'Killed'),
  );
}

test('filesBelowFloor names a file at 79% with the mutants its tests let through', () => {
  const files: ReportFiles = {
    // 15 detected of 19 valid: 78.9%.
    'src/a.ts': file([
      ...killed(15, 'a'),
      mutant('s1', 'Survived', 3, 'EqualityOperator'),
      mutant('s2', 'Survived', 7, 'StringLiteral'),
      mutant('s3', 'Survived', 7, 'BooleanLiteral'),
      mutant('s4', 'NoCoverage', 12, 'BlockStatement'),
    ]),
    'src/b.ts': file(killed(5, 'b')),
    'src/c/d.ts': file(killed(3, 'd')),
  };

  const failures = filesBelowFloor(files);

  expect(failures).toEqual([
    {
      file: 'src/a.ts',
      score: (15 / 19) * 100,
      survivors: [
        { line: 3, mutator: 'EqualityOperator', status: 'Survived' },
        { line: 7, mutator: 'StringLiteral', status: 'Survived' },
        { line: 7, mutator: 'BooleanLiteral', status: 'Survived' },
        { line: 12, mutator: 'BlockStatement', status: 'NoCoverage' },
      ],
    },
  ]);
});

test('filesBelowFloor passes a file at exactly 80%', () => {
  const files: ReportFiles = {
    'src/a.ts': file([...killed(4, 'a'), mutant('s1', 'Survived')]),
  };

  const failures = filesBelowFloor(files);

  expect(failures).toEqual([]);
});

test('filesBelowFloor passes a file with no valid mutants', () => {
  const files: ReportFiles = {
    'src/a.ts': file([
      mutant('c1', 'CompileError'),
      mutant('r1', 'RuntimeError'),
      mutant('i1', 'Ignored'),
    ]),
  };

  const failures = filesBelowFloor(files);

  expect(failures).toEqual([]);
});

test('filesBelowFloor passes a report with no files', () => {
  const failures = filesBelowFloor({});

  expect(failures).toEqual([]);
});

test('formatVerdict names each failing file with its score and each mutant it let through', () => {
  const verdict = formatVerdict([
    {
      file: 'src/a.ts',
      score: (15 / 19) * 100,
      survivors: [
        { line: 3, mutator: 'EqualityOperator', status: 'Survived' },
        { line: 12, mutator: 'BlockStatement', status: 'NoCoverage' },
      ],
    },
    {
      file: 'src/b.ts',
      score: 50,
      survivors: [{ line: 2, mutator: 'StringLiteral', status: 'Survived' }],
    },
  ]);

  expect(verdict).toBe(
    [
      'Below the mutation floor of 80%:',
      '  src/a.ts: 78.95%',
      '    src/a.ts:3 EqualityOperator (Survived)',
      '    src/a.ts:12 BlockStatement (NoCoverage)',
      '  src/b.ts: 50.00%',
      '    src/b.ts:2 StringLiteral (Survived)',
    ].join('\n'),
  );
});

test('formatVerdict says every file reaches the floor when none fails', () => {
  const verdict = formatVerdict([]);

  expect(verdict).toBe('Every file reaches the mutation floor of 80%.');
});
