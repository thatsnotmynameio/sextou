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
  doltPasswordFile: string;
  bdServeTokenFile: string;
  doltRun: string;
  bdServeRun: string;
  doltLog: string;
  bdServeLog: string;
  // Every folder above, the data directory first.
  folders: string[];
}

export function layoutOf(dataDir: string): Layout {
  const at = (...segments: string[]) => path.join(dataDir, ...segments);
  const bin = at('bin');
  const dolt = at('dolt');
  const doltHome = at('dolt-home');
  const beads = at('beads');
  const organization = path.join(beads, 'default');
  const secrets = at('secrets');
  const run = at('run');
  const logs = at('logs');
  return {
    bin,
    dolt,
    doltHome,
    organization,
    beadsDir: path.join(organization, '.beads'),
    doltPasswordFile: path.join(secrets, 'dolt-password'),
    bdServeTokenFile: path.join(secrets, 'bd-serve-token'),
    doltRun: path.join(run, 'dolt.json'),
    bdServeRun: path.join(run, 'bd-serve-default.json'),
    doltLog: path.join(logs, 'dolt.log'),
    bdServeLog: path.join(logs, 'bd-serve-default.log'),
    folders: [
      dataDir,
      bin,
      dolt,
      doltHome,
      beads,
      organization,
      secrets,
      run,
      logs,
    ],
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
