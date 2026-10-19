import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig(({ mode }) => ({
  define: {
    // The web app the window loads: apps/web's dev server in development
    // (its port is pinned in apps/web/vite.config.ts), the deployed web app
    // in a packaged build, read from SEXTOU_WEB_URL when it is packaged.
    SEXTOU_WEB_URL: JSON.stringify(
      mode === 'development'
        ? 'http://localhost:5173'
        : (process.env.SEXTOU_WEB_URL ?? ''),
    ),
  },
}));
