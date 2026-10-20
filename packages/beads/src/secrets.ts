import { randomBytes } from 'node:crypto';
import { linkSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

// The credential in file, created on the first read and never regenerated:
// 32 random bytes in base64url. It is written to a temporary name for its
// owner only, then linked into place, so a crash leaves no partial file.
export function readOrCreateSecret(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const secret = randomBytes(32).toString('base64url');
  const temporary = `${file}.tmp-${randomBytes(6).toString('hex')}`;
  writeFileSync(temporary, secret, { mode: 0o600, flag: 'wx' });
  try {
    linkSync(temporary, file);
  } finally {
    unlinkSync(temporary);
  }
  return secret;
}
