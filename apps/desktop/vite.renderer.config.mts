import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { lingui } from '@lingui/vite-plugin';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [
    react(),
    // The Lingui config is the `lingui` key in this package's package.json,
    // found from here even when another tool (knip) loads this file.
    // Each message keeps its source text in production builds: there are no
    // compiled catalogs yet, so the runtime compiles the English text.
    lingui({
      cwd: import.meta.dirname,
      macroTransform: { macro: { descriptorFields: 'message' } },
    }),
    tailwindcss(),
  ],
});
