import { defineConfig } from 'vite';

// https://vitejs.dev/config
// The production build: src/main.ts and everything it imports, the
// workspace packages and node_modules included, in one dist/server.mjs that
// needs only Node.
export default defineConfig({
  ssr: {
    noExternal: true,
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
