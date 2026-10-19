import type { DatabaseSync } from 'node:sqlite';
import { migrations as shipped } from './migration.gen';
import type { Migration } from './migration-files';

// Applies the migrations the database doesn't have yet, in order, in one
// transaction, and returns their ids. Throws, with the database left as it
// was, when one fails or when the database records a migration missing from
// the list, which a newer sextou wrote.
export function migrateDatabase(
  client: DatabaseSync,
  migrations: Migration[] = shipped,
): string[] {
  client.exec('BEGIN');
  try {
    // Created inside the transaction, so a failed first start leaves no trace.
    client.exec(
      'CREATE TABLE IF NOT EXISTS migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)',
    );

    const known = new Set(migrations.map((migration) => migration.id));
    const applied = new Set(
      client
        .prepare('SELECT id FROM migration')
        .all()
        .map((row) => String(row.id)),
    );
    const unknown = [...applied].find((id) => !known.has(id));
    if (unknown !== undefined) {
      throw new Error(
        `This database was written by a newer sextou (unknown migration ${unknown})`,
      );
    }

    const pending = migrations.filter(
      (migration) => !applied.has(migration.id),
    );
    const record = client.prepare(
      'INSERT INTO migration (id, time_completed) VALUES (?, ?)',
    );
    for (const { id, statements } of pending) {
      try {
        for (const statement of statements) client.exec(statement);
        record.run(id, Date.now());
      } catch (error) {
        throw new Error(`Migration ${id} failed: ${(error as Error).message}`, {
          cause: error,
        });
      }
    }
    client.exec('COMMIT');
    return pending.map((migration) => migration.id);
  } catch (error) {
    client.exec('ROLLBACK');
    throw error;
  }
}
