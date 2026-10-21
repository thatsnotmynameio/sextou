import type { Database } from '@tursodatabase/database';
import { migrations as shipped } from './migration.gen';
import type { Migration } from './migration-files';

// Applies the migrations the database doesn't have yet, in order, in one
// transaction, and returns their ids. Throws, with the database left as it
// was, when one fails or when the database records a migration missing from
// the list, which a newer sextou wrote.
export async function migrateDatabase(
  client: Database,
  migrations: Migration[] = shipped,
): Promise<string[]> {
  // The wrapper commits when the callback returns and rolls back when it
  // throws. Every statement inside goes through txn: one on client waits for
  // the transaction to end, which never happens.
  return client
    .transactionAsync(async (txn) => {
      // Created inside the transaction, so a failed first start leaves no trace.
      await txn.exec(
        'CREATE TABLE IF NOT EXISTS migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)',
      );

      const known = new Set(migrations.map((migration) => migration.id));
      const rows: { id: unknown }[] = await txn.all('SELECT id FROM migration');
      const applied = new Set(rows.map((row) => String(row.id)));
      const unknown = [...applied].find((id) => !known.has(id));
      if (unknown !== undefined) {
        throw new Error(
          `This database was written by a newer sextou (unknown migration ${unknown})`,
        );
      }

      const pending = migrations.filter(
        (migration) => !applied.has(migration.id),
      );
      const record = await txn.prepare(
        'INSERT INTO migration (id, time_completed) VALUES (?, ?)',
      );
      for (const { id, statements } of pending) {
        try {
          for (const statement of statements) await txn.exec(statement);
          await record.run(id, Date.now());
        } catch (error) {
          throw new Error(
            `Migration ${id} failed: ${(error as Error).message}`,
            { cause: error },
          );
        }
      }
      return pending.map((migration) => migration.id);
    })
    .immediate();
}
