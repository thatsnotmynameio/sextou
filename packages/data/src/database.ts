import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sql } from 'drizzle-orm';
import { drizzle, type NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';

export interface Database {
  // The drizzle handle features query through.
  db: NodeSQLiteDatabase;
  // Whether the database answers a query. Never throws.
  ping(): boolean;
  // Closes the database; does nothing once closed.
  close(): void;
}

// Opens the SQLite database at an absolute file path, or in memory for
// ':memory:'. Throws when it can't, with the error from the file system or
// SQLite.
export function openDatabase(path: string): Database {
  const inMemory = path === ':memory:';
  if (!inMemory) restrictToOwner(path);

  const client = new DatabaseSync(path);
  try {
    // SQLite opens a file that isn't a database without complaint and fails
    // on the first statement: running one here makes that an open failure.
    // WAL lets reads run while a write is in progress.
    client.exec(
      inMemory
        ? 'select 1'
        : 'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL',
    );
  } catch (error) {
    client.close();
    throw error;
  }

  const db = drizzle({ client });
  return {
    db,
    ping() {
      try {
        db.get(sql`select 1`);
        return true;
      } catch {
        return false;
      }
    },
    close() {
      // A second DatabaseSync.close() throws.
      if (client.isOpen) client.close();
    },
  };
}

// Creates the folder and the file for their owner only, and makes an existing
// file and its WAL sidecars owner-only too. SQLite gives new sidecars the main
// file's mode, so the file must be owner-only before SQLite opens it.
function restrictToOwner(path: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  closeSync(openSync(path, 'a', 0o600));
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(file)) chmodSync(file, 0o600);
  }
}
