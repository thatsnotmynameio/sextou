import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// Where beads' pieces live in sextou's data directory.
export interface Layout {
  bin: string;
  // Dolt's --data-dir.
  dolt: string;
  // Dolt's DOLT_ROOT_PATH and every child's home.
  doltHome: string;
  // The default organization's working folder and its BEADS_DIR.
  organization: string;
  beadsDir: string;
  doltPassword: string;
  bdServeToken: string;
  doltRun: string;
  bdServeRun: string;
  doltLog: string;
  bdServeLog: string;
  // Every folder above, the data directory first.
  folders: string[];
}

export function layoutOf(dataDir: string): Layout {
  const at = (...segments: string[]) => path.join(dataDir, ...segments);
  const folders = [
    dataDir,
    at('bin'),
    at('dolt'),
    at('dolt-home'),
    at('beads'),
    at('beads', 'default'),
    at('secrets'),
    at('run'),
    at('logs'),
  ];
  return {
    bin: at('bin'),
    dolt: at('dolt'),
    doltHome: at('dolt-home'),
    organization: at('beads', 'default'),
    beadsDir: at('beads', 'default', '.beads'),
    doltPassword: at('secrets', 'dolt-password'),
    bdServeToken: at('secrets', 'bd-serve-token'),
    doltRun: at('run', 'dolt.json'),
    bdServeRun: at('run', 'bd-serve-default.json'),
    doltLog: at('logs', 'dolt.log'),
    bdServeLog: at('logs', 'bd-serve-default.log'),
    folders,
  };
}

// Creates each folder for its owner only, and makes existing ones owner-only,
// so beads' data, logs and credentials are as private as the database.
export function prepareFolders(layout: Layout) {
  for (const folder of layout.folders) {
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    chmodSync(folder, 0o700);
  }
}
