import { defineConfig } from 'vite';

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
