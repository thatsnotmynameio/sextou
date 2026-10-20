import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readOrCreateSecret } from './secrets';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-secrets-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readOrCreateSecret', () => {
  it('creates a missing credential from 32 random bytes, for its owner only', () => {
    const file = join(dir, 'token');

    const secret = readOrCreateSecret(file);

    expect(Buffer.from(secret, 'base64url')).toHaveLength(32);
    expect(readFileSync(file, 'utf8')).toBe(secret);
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    // The temporary file it linked into place is gone.
    expect(readdirSync(dir)).toEqual(['token']);
  });

  it('returns the same credential on a second read', () => {
    const file = join(dir, 'token');
    expect(readOrCreateSecret(file)).toBe(readOrCreateSecret(file));
  });

  it('creates a different credential in each file', () => {
    expect(readOrCreateSecret(join(dir, 'a'))).not.toBe(
      readOrCreateSecret(join(dir, 'b')),
    );
  });

  it('returns an existing credential as it is, without rewriting it', () => {
    const file = join(dir, 'token');
    writeFileSync(file, 'existing', { mode: 0o600 });
    const before = statSync(file).mtimeMs;

    expect(readOrCreateSecret(file)).toBe('existing');
    expect(statSync(file).mtimeMs).toBe(before);
  });

  // Only a missing file is created; any other error is not a missing secret.
  it('throws when the file cannot be read', () => {
    expect(() => readOrCreateSecret(dir)).toThrow('EISDIR');
  });
});
