// Judges a Stryker JSON report against the per-file mutation floor, and exits
// with 1 when a file is below it. A package runs it by path after Stryker, so
// it gains no dependency on this one:
//
//   node ../../.github/scripts/src/mutation-floor-cli.ts reports/mutation/mutation.json
import { readFileSync } from 'node:fs';
import {
  filesBelowFloor,
  formatVerdict,
  type ReportFiles,
} from './mutation-floor.ts';

const path = process.argv[2];
const files = readFiles(path);

if (files === undefined) {
  process.exitCode = 1;
} else {
  const failures = filesBelowFloor(files);
  if (failures.length === 0) {
    console.log(formatVerdict(failures));
  } else {
    console.error(formatVerdict(failures));
    process.exitCode = 1;
  }
}

function readFiles(path: string): ReportFiles | undefined {
  try {
    const { files } = JSON.parse(readFileSync(path, 'utf8')) as {
      files?: ReportFiles;
    };
    if (typeof files === 'object') return files;
    console.error(`${path} is not a Stryker mutation report: it has no files.`);
  } catch (error) {
    console.error(
      `Could not read the mutation report at ${path}: ${(error as Error).message}`,
    );
  }
  return undefined;
}
