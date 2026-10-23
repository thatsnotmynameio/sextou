import { join } from 'node:path';
import { connect } from '@tursodatabase/database';
import { drizzle } from 'drizzle-orm/tursodatabase/database';
import { migrate } from 'drizzle-orm/tursodatabase/migrator';
import { createGraph, type Graph, type Logger } from './graph';
import { restrictToOwner } from './owner-only';

// The migrations drizzle-kit generates from schema.ts, in this package.
const packageMigrations = join(import.meta.dirname, '..', 'drizzle');

export interface Tasks extends Graph {
  // Closes the database; does nothing once closed.
  close: () => Promise<void>;
}

export interface OpenTasksOptions {
  // Where the graph logs: the caller's logger, such as the server's.
  logger: Logger;
  // The absolute path of a copy of the package's drizzle folder, for a
  // caller whose bundle carries this package without its files. The
  // package's own folder by default.
  migrationsFolder?: string;
  // The clock, in milliseconds since the epoch, for every recorded time and
  // lease: Date.now by default.
  now?: () => number;
}

// Opens the task graph kept in the database file at an absolute path, or in
// memory for ':memory:', and applies the migrations the file doesn't have
// yet. Rejects when it can't, with the error from the file system, Turso or
// the migrations. Turso opens every file in WAL mode, which lets reads run
// while a write is in progress, and refuses a second process.
export async function openTasks(
  path: string,
  {
    logger,
    migrationsFolder = packageMigrations,
    now = () => Date.now(),
  }: OpenTasksOptions,
): Promise<Tasks> {
  if (path !== ':memory:') {
    restrictToOwner(path);
  }

  // Connecting here, not in drizzle, rejects a file that is not a database
  // now rather than at the first query.
  const client = await connect(path);
  const db = drizzle({ client });
  try {
    // Turso leaves foreign keys off. FULL makes a write survive a power cut
    // once it returns. Both hold for the connection, migrations included.
    await client.exec('PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL');
    await migrate(db, { migrationsFolder });
  } catch (error) {
    await client.close();
    throw error;
  }

  return { ...createGraph(db, logger, now), close: () => client.close() };
}
