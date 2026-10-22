import { defineConfig } from 'vite';

// https://vitejs.dev/config
// The production build: src/main.ts and everything it imports, node_modules
// included, in one dist/runner.mjs, but for Pino and pino-pretty, which
// runner.mjs imports at run time from node_modules: Pino loads its
// transports' files at run time, which a bundle doesn't carry.
export default defineConfig({
  ssr: {
    noExternal: true,
    // An explicit external wins over noExternal.
    external: ['pino', 'pino-pretty'],
  },
  build: {
    ssr: true,
    target: 'node24',
    outDir: 'dist',
    rolldownOptions: {
      input: 'src/main.ts',
      output: {
        entryFileNames: 'runner.mjs',
      },
    },
  },
});
