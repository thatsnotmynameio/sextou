import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { restrictToOwner } from './owner-only';

let dir: string;

function mode(path: string) {
  return statSync(path).mode & 0o777;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-tasks-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// File modes mean nothing on Windows, where the profile's permissions apply.
describe.skipIf(process.platform === 'win32')('restrictToOwner', () => {
  it('creates a missing folder and an empty file for their owner only', () => {
    const path = join(dir, 'missing', 'graph.db');
    restrictToOwner(path);
    expect(mode(join(dir, 'missing'))).toBe(0o700);
    expect(mode(path)).toBe(0o600);
    expect(readFileSync(path, 'utf8')).toBe('');
  });

  // A crash leaves the sidecars behind, with whatever mode they had.
  it('makes an existing file and its sidecars owner-only, keeping their bytes', () => {
    const path = join(dir, 'graph.db');
    for (const file of [path, `${path}-wal`, `${path}-shm`]) {
      writeFileSync(file, 'kept');
      chmodSync(file, 0o644);
    }
    restrictToOwner(path);
    for (const file of [path, `${path}-wal`, `${path}-shm`]) {
      expect(mode(file)).toBe(0o600);
      expect(readFileSync(file, 'utf8')).toBe('kept');
    }
  });

  it('throws when the folder is a regular file', () => {
    writeFileSync(join(dir, 'file'), '');
    expect(() => restrictToOwner(join(dir, 'file', 'graph.db'))).toThrow(
      'EEXIST',
    );
  });
});
