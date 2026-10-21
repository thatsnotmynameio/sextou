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
import { afterEach, beforeEach, expect, test } from 'vitest';
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
test.skipIf(process.platform === 'win32')(
  'restrictToOwner creates a missing folder, an empty file and its sidecar for their owner only',
  () => {
    const path = join(dir, 'missing', 'graph.db');
    restrictToOwner(path);
    expect(mode(join(dir, 'missing'))).toBe(0o700);
    for (const file of [path, `${path}-wal`]) {
      expect(mode(file)).toBe(0o600);
      expect(readFileSync(file, 'utf8')).toBe('');
    }
  },
);

// A crash leaves the sidecar behind, with whatever mode it had.
test.skipIf(process.platform === 'win32')(
  'restrictToOwner makes an existing file and its sidecar owner-only, keeping their bytes',
  () => {
    const path = join(dir, 'graph.db');
    for (const file of [path, `${path}-wal`]) {
      writeFileSync(file, 'kept');
      chmodSync(file, 0o644);
    }
    restrictToOwner(path);
    for (const file of [path, `${path}-wal`]) {
      expect(mode(file)).toBe(0o600);
      expect(readFileSync(file, 'utf8')).toBe('kept');
    }
  },
);

test.skipIf(process.platform === 'win32')(
  'restrictToOwner throws when the folder is a regular file',
  () => {
    writeFileSync(join(dir, 'file'), '');
    expect(() => restrictToOwner(join(dir, 'file', 'graph.db'))).toThrow(
      'EEXIST',
    );
  },
);
