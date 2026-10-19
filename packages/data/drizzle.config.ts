import { defineConfig } from 'drizzle-kit';

// drizzle-kit generate turns a change to src/schema.ts into
// migration/<time>_<name>/migration.sql. Run it through
// `pnpm --filter @sextou/data migration`, which also renders
// src/migration.gen.ts.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './migration',
});
