import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';

// @sextou/tasks reads its migrations from its drizzle folder at run time.
// The bundle inlines the package's code but not that folder, so the build
// copies it beside server.mjs and tells main.ts where through
// __TASKS_MIGRATIONS__.
const tasksMigrations = join(
  import.meta.dirname,
  '..',
  '..',
  'packages',
  'tasks',
  'drizzle',
);

// https://vitejs.dev/config
// The production build: src/main.ts and everything it imports, the
// workspace packages and node_modules included, in one dist/server.mjs, but
// for the packages server.mjs imports at run time from node_modules. Turso is
// a native addon, which a bundle can't hold, so it runs with Turso's installed
// package for its platform. Pino and pino-pretty stay installed too: Pino
// loads its transports' files at run time, which a bundle doesn't carry.
export default defineConfig({
  ssr: {
    noExternal: true,
    // An explicit external wins over noExternal.
    external: ['@tursodatabase/database', 'pino', 'pino-pretty'],
  },
  define: {
    // The migrations' folder, relative to server.mjs.
    __TASKS_MIGRATIONS__: JSON.stringify('drizzle'),
  },
  plugins: [
    {
      name: 'copy-tasks-migrations',
      writeBundle({ dir = 'dist' }) {
        cpSync(tasksMigrations, join(dir, 'drizzle'), { recursive: true });
      },
    },
  ],
  build: {
    ssr: true,
    target: 'node24',
    outDir: 'dist',
    rolldownOptions: {
      input: 'src/main.ts',
      output: {
        entryFileNames: 'server.mjs',
      },
    },
  },
});
