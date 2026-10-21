// The per-file mutation floor. Stryker's thresholds.break judges only the
// whole report's score, so this judges each source file in its JSON report.
import { calculateMetrics } from 'mutation-testing-metrics';

// The files of a Stryker JSON report (mutation-testing-report-schema).
export type ReportFiles = Parameters<typeof calculateMetrics>[0];

// The score every source file must reach, in percent.
export const floor = 80;

// A mutant the file's tests let through.
export interface Survivor {
  line: number;
  mutator: string;
  status: string;
}

export interface FileBelowFloor {
  file: string;
  score: number;
  survivors: Survivor[];
}

// Each file whose score is below the floor, with the mutants its tests let
// through. mutation-testing-metrics scores a file as Stryker does: Killed and
// Timeout mutants over the valid ones, which add Survived and NoCoverage;
// CompileError, RuntimeError, Ignored and Pending don't count. A file with no
// valid mutant scores NaN and passes: there is nothing to catch.
export function filesBelowFloor(files: ReportFiles): FileBelowFloor[] {
  return Object.entries(files).flatMap(([file, result]) => {
    const score = calculateMetrics({ [file]: result }).metrics.mutationScore;
    if (Number.isNaN(score) || score >= floor) return [];
    const survivors = result.mutants
      .filter(({ status }) => status === 'Survived' || status === 'NoCoverage')
      .map(({ location, mutatorName, status }) => ({
        line: location.start.line,
        mutator: mutatorName,
        status,
      }));
    return [{ file, score, survivors }];
  });
}

// What the CI log shows: each failing file with its score and survivors, or
// one line when every file passes.
export function formatVerdict(failures: FileBelowFloor[]): string {
  if (failures.length === 0) {
    return `Every file reaches the mutation floor of ${floor}%.`;
  }
  return [
    `Below the mutation floor of ${floor}%:`,
    ...failures.flatMap(({ file, score, survivors }) => [
      `  ${file}: ${score.toFixed(2)}%`,
      ...survivors.map(
        ({ line, mutator, status }) =>
          `    ${file}:${line} ${mutator} (${status})`,
      ),
    ]),
  ].join('\n');
}
