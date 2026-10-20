import { DatabaseSync } from 'node:sqlite';
import { createGraph, type Graph } from './graph';
import { migrate } from './migrations';
import { restrictToOwner } from './owner-only';

export interface Tasks extends Graph {
  // Closes the database; does nothing once closed.
  close: () => void;
}

// Opens the task graph kept in the SQLite file at an absolute path, or in
// memory for ':memory:', and applies the migrations the file doesn't have yet.
// Throws when it can't, with the error from the file system, SQLite or the
// migrations.
export function openTasks(path: string): Tasks {
  const inMemory = path === ':memory:';
  if (!inMemory) restrictToOwner(path);

  const client = new DatabaseSync(path);
  try {
    // A second process waits for the write lock instead of failing at once.
    client.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON');
    // Before WAL, which rewrites the header: a file a newer version wrote is
    // refused unchanged.
    migrate(client);
    // WAL lets reads run while a write is in progress. FULL makes a write
    // survive a power cut once it returns.
    if (!inMemory) client.exec('PRAGMA journal_mode = WAL');
    client.exec('PRAGMA synchronous = FULL');
  } catch (error) {
    client.close();
    throw error;
  }

  return {
    ...createGraph(client),
    close: () => {
      // A second DatabaseSync.close() throws.
      if (client.isOpen) client.close();
    },
  };
}
