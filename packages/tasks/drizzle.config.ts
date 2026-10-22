import { join } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit generate turns a change to src/schema.ts into
// drizzle/<time>_<name>/migration.sql, which openTasks applies. Paths are
// absolute: drizzle-kit resolves relative ones against the working directory,
// the repository's root under a root `vitest run`. No driver: drizzle-kit
// only generates, and the native Turso driver needs none.
export default defineConfig({
  dialect: 'sqlite',
  schema: join(import.meta.dirname, 'src', 'schema.ts'),
  out: join(import.meta.dirname, 'drizzle'),
});
