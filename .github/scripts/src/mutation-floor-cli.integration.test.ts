import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ReportFiles } from './mutation-floor.ts';

const entry = join(import.meta.dirname, 'mutation-floor-cli.ts');

let dir: string;

// A Stryker report with the given files, written to the temporary directory.
function writeReport(files: ReportFiles): string {
  return writeText(
    JSON.stringify({
      schemaVersion: '2',
      thresholds: { high: 80, low: 60 },
      files,
    }),
  );
}

function writeText(text: string): string {
  const path = join(dir, 'mutation.json');
  writeFileSync(path, text);
  return path;
}

// One file with a killed mutant and, when asked, a survivor on line 4.
function report(withSurvivor: boolean): ReportFiles {
  const location = {
    start: { line: 4, column: 1 },
    end: { line: 4, column: 9 },
  };
  return {
    'src/a.ts': {
      language: 'typescript',
      source: 'export {};\n',
      mutants: [
        { id: '1', mutatorName: 'StringLiteral', status: 'Killed', location },
        ...(withSurvivor
          ? [
              {
                id: '2',
                mutatorName: 'EqualityOperator',
                status: 'Survived' as const,
                location,
              },
            ]
          : []),
      ],
    },
  };
}

// Runs the entry in this process on the path, as `node <entry> <path>` would.
async function run(path: string) {
  vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', entry, path]);
  await import('./mutation-floor-cli.ts');
}

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), 'sextou-mutation-floor-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

test('the entry passes a report where every file reaches the floor', async () => {
  const path = writeReport(report(false));

  await run(path);

  expect(process.exitCode).toBeUndefined();
  expect(console.log).toHaveBeenCalledWith(
    'Every file reaches the mutation floor of 80%.',
  );
});

test('the entry exits with 1 naming a file below the floor and its survivors', async () => {
  const path = writeReport(report(true));

  await run(path);

  expect(process.exitCode).toBe(1);
  expect(console.error).toHaveBeenCalledWith(
    [
      'Below the mutation floor of 80%:',
      '  src/a.ts: 50.00%',
      '    src/a.ts:4 EqualityOperator (Survived)',
    ].join('\n'),
  );
});

test('the entry exits with 1 when the report file is missing', async () => {
  const path = join(dir, 'missing.json');

  await run(path);

  expect(process.exitCode).toBe(1);
  expect(console.error).toHaveBeenCalledWith(
    expect.stringContaining(`Could not read the mutation report at ${path}`),
  );
});

test('the entry exits with 1 when the file is not JSON', async () => {
  const path = writeText('<!doctype html><title>Mutation report</title>');

  await run(path);

  expect(process.exitCode).toBe(1);
  expect(console.error).toHaveBeenCalledWith(
    expect.stringContaining(`Could not read the mutation report at ${path}`),
  );
});

test('the entry exits with 1 when the JSON is not a Stryker report', async () => {
  const path = writeText(JSON.stringify({ name: '@sextou/tasks' }));

  await run(path);

  expect(process.exitCode).toBe(1);
  expect(console.error).toHaveBeenCalledWith(
    `${path} is not a Stryker mutation report: it has no files.`,
  );
});

test('node runs the entry by path, with its type stripping', () => {
  const path = writeReport(report(false));

  const result = spawnSync(process.execPath, [entry, path], {
    encoding: 'utf8',
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toBe('Every file reaches the mutation floor of 80%.\n');
});
