import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { linguiMacros } from '@sextou/ui/lingui-macros';
import { contentSecurityPolicy } from './content-security-policy';
import { readSettings } from './settings';

// https://vitejs.dev/config
export default defineConfig(({ mode }) => {
  // The environment, over apps/web/.env and its mode files. Only SEXTOU_WEB_
  // variables are read, and only the ones `define` names reach the bundle:
  // every one of those is public.
  const settings = readSettings(
    loadEnv(mode, import.meta.dirname, 'SEXTOU_WEB_'),
  );
  return {
    plugins: [
      // Generates src/routeTree.gen.ts from src/routes/, before React's
      // plugin compiles the routes. Its hot-reload code, appended to each
      // route, runs only on the dev server, so tests leave it out.
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
        codeSplittingOptions: { addHmr: mode !== 'test' },
        quoteStyle: 'single',
        semicolons: true,
      }),
      react(),
      linguiMacros(),
      tailwindcss(),
      contentSecurityPolicy(settings.serverUrl),
    ],
    define: {
      SEXTOU_WEB_SERVER_URL: JSON.stringify(settings.serverUrl),
      SEXTOU_WEB_REQUEST_TIMEOUT_MS: JSON.stringify(settings.requestTimeoutMs),
    },
    // The desktop app loads this dev server in development, and the server
    // lets its origin call it (SEXTOU_SERVER_WEB_ORIGIN).
    server: { port: settings.port, strictPort: true },
  };
});
