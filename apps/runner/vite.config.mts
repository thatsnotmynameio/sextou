import { defineConfig } from 'vite';

// https://vitejs.dev/config
// The production build: src/main.ts and everything it imports, the
// workspace packages and node_modules included, in one dist/runner.mjs, but
// for Pino and pino-pretty, which stay installed: Pino loads its transports'
// files at run time, which a bundle doesn't carry. @sextou/logger declares
// them, and the hoisted node_modules puts them where runner.mjs finds them.
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
