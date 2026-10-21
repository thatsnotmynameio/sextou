import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { connect } from '@tursodatabase/database';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/tursodatabase/database';
import type { TursoDatabaseDatabase } from 'drizzle-orm/tursodatabase';
import { migrateDatabase } from './migration';

export interface Database {
  // The drizzle handle features query through.
  db: TursoDatabaseDatabase;
  // Whether the database answers a query. Never rejects.
  ping: () => Promise<boolean>;
  // Closes the database; does nothing once closed.
  close: () => Promise<void>;
}

// Opens the SQLite database at an absolute file path, or in memory for
// ':memory:', and applies the migrations it doesn't have yet. Rejects when it
// can't, with the error from the file system, Turso or the migrations.
//
// Turso opens every database in WAL mode, which lets reads run while a write
// is in progress, and syncs in full on each commit, its default. It rejects a
// file that isn't a database when connecting.
export async function openDatabase(path: string): Promise<Database> {
  if (path !== ':memory:') restrictToOwner(path);

  const client = await connect(path);
  try {
    // Turso leaves foreign keys off unless the connection turns them on.
    await client.exec('PRAGMA foreign_keys = ON');
    await migrateDatabase(client);
  } catch (error) {
    await client.close();
    throw error;
  }

  const db = drizzle({ client });
  return {
    db,
    ping: async () => {
      try {
        await db.get(sql`select 1`);
        return true;
      } catch {
        return false;
      }
    },
    close: () => client.close(),
  };
}

// Creates the folder, the file and its WAL file for their owner only, and
// makes an existing file and WAL file owner-only too. Turso writes no other
// sidecar, keeps the WAL file after closing, and creates it with the umask's
// mode, so the WAL file must exist, owner-only, before Turso opens the file.
function restrictToOwner(path: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  for (const file of [path, `${path}-wal`]) {
    closeSync(openSync(file, 'a', 0o600));
    chmodSync(file, 0o600);
  }
}
