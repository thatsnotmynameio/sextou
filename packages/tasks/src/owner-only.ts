import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';

// Creates the folder and the file for their owner only, and makes an existing
// file and its WAL sidecars owner-only too. SQLite gives new sidecars the main
// file's mode, so the file must be owner-only before SQLite opens it.
export function restrictToOwner(path: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  closeSync(openSync(path, 'a', 0o600));
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(file)) chmodSync(file, 0o600);
  }
}
