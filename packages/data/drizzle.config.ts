import { join } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit generate turns a change to src/schema.ts into
// migration/<time>_<name>/migration.sql. Run it through
// `pnpm --filter @sextou/data migration`, which also renders
// src/migration.gen.ts. Paths are absolute: drizzle-kit resolves relative ones
// against the working directory, the repository's root under a root
// `vitest run`.
export default defineConfig({
  dialect: 'sqlite',
  schema: join(import.meta.dirname, 'src', 'schema.ts'),
  out: join(import.meta.dirname, 'migration'),
});
