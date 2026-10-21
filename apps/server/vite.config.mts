import { defineConfig } from 'vite';

// https://vitejs.dev/config
// The production build: src/main.ts and everything it imports, the
// workspace packages and node_modules included, in one dist/server.mjs. Turso
// is a native addon, which a bundle can't hold: server.mjs imports it at run
// time, so it runs with Node and Turso's installed package for its platform.
export default defineConfig({
  ssr: {
    noExternal: true,
    // An explicit external wins over noExternal.
    external: ['@tursodatabase/database'],
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
