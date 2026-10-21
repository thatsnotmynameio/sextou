import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';

// Creates the folder, the file and its WAL sidecar for their owner only, and
// makes existing ones owner-only too. Turso creates a missing sidecar with the
// umask's mode and keeps it after closing, so the sidecar must exist,
// owner-only, before Turso opens the file.
export function restrictToOwner(path: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  for (const file of [path, `${path}-wal`]) {
    closeSync(openSync(file, 'a', 0o600));
    chmodSync(file, 0o600);
  }
}
