import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { layoutOf, prepareFolders } from './layout';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-layout-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const mode = (path: string) => statSync(path).mode & 0o777;

describe('layoutOf', () => {
  it('keeps every piece inside the data directory', () => {
    const layout = layoutOf('/d');
    expect(layout).toMatchObject({
      bin: '/d/bin',
      dolt: '/d/dolt',
      doltHome: '/d/dolt-home',
      organization: '/d/beads/default',
      beadsDir: '/d/beads/default/.beads',
      doltPassword: '/d/secrets/dolt-password',
      bdServeToken: '/d/secrets/bd-serve-token',
      doltRun: '/d/run/dolt.json',
      bdServeRun: '/d/run/bd-serve-default.json',
      doltLog: '/d/logs/dolt.log',
      bdServeLog: '/d/logs/bd-serve-default.log',
    });
  });
});

describe.runIf(process.platform !== 'win32')('prepareFolders', () => {
  it('creates each folder for its owner only', () => {
    const layout = layoutOf(join(dir, 'data'));
    prepareFolders(layout);
    for (const folder of layout.folders) expect(mode(folder)).toBe(0o700);
  });

  it('makes a data directory that already exists owner-only', () => {
    const data = join(dir, 'data');
    mkdirSync(join(data, 'logs'), { recursive: true, mode: 0o755 });
    const layout = layoutOf(data);

    prepareFolders(layout);

    expect(mode(data)).toBe(0o700);
    expect(mode(layout.doltLog.replace(/\/dolt\.log$/, ''))).toBe(0o700);
  });
});
