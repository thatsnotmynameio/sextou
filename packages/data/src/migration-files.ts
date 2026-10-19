import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Migration {
  // The migration's folder name, which drizzle-kit starts with its UTC time.
  id: string;
  statements: string[];
}

// The migrations drizzle-kit generated into a folder, oldest first: each
// subfolder's migration.sql, split into statements. A missing folder has none.
export function readMigrationFolder(directory: string): Migration[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(directory, entry.name, 'migration.sql')),
    )
    .map((entry) => entry.name)
    .sort()
    .map((id) => ({
      id,
      statements: readFileSync(join(directory, id, 'migration.sql'), 'utf8')
        .replaceAll('\r\n', '\n')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter((statement) => statement !== ''),
    }));
}
