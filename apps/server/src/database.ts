import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/tursodatabase/database';
import { withTimeout } from './timeout';

export interface Database {
  // Whether the database answers a query within the timeout. Never rejects.
  ping: () => Promise<boolean>;
  close: () => Promise<void>;
}

// drizzle on Turso, for an absolute file path or ':memory:'. Nothing opens
// here: Turso connects on the first query, so a path it can't open fails
// each query instead, and the server starts whatever the file's state.
//
// Turso interrupts a statement that runs past the timeout, but not a wait
// for its lock or for the connection, which the ping's own timer covers.
export function createDatabase(path: string, timeoutMs: number): Database {
  const db = drizzle({ connection: { path, defaultQueryTimeout: timeoutMs } });
  return {
    ping: () =>
      withTimeout(db.get(sql`select 1`), timeoutMs).then(
        () => true,
        () => false,
      ),
    close: () => db.$client.close(),
  };
}
