import { connect } from '@tursodatabase/database';
import { createGraph, type Graph, type Logger } from './graph';
import { migrate } from './migrations';
import { restrictToOwner } from './owner-only';

export interface Tasks extends Graph {
  // Closes the database; does nothing once closed.
  close: () => Promise<void>;
}

export interface OpenTasksOptions {
  // Where the graph logs: the caller's logger, such as the server's.
  logger: Logger;
}

// Opens the task graph kept in the database file at an absolute path, or in
// memory for ':memory:', and applies the migrations the file doesn't have
// yet. Rejects when it can't, with the error from the file system, Turso or
// the migrations. Turso opens every file in WAL mode, which lets reads run
// while a write is in progress, and refuses a second process.
export async function openTasks(
  path: string,
  { logger }: OpenTasksOptions,
): Promise<Tasks> {
  if (path !== ':memory:') {
    restrictToOwner(path);
  }

  const client = await connect(path);
  try {
    // Turso leaves foreign keys off. FULL makes a write survive a power cut
    // once it returns.
    await client.exec('PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL');
    await migrate(client);
  } catch (error) {
    await client.close();
    throw error;
  }

  return {
    ...createGraph(client, logger),
    close: () => client.close(),
  };
}
