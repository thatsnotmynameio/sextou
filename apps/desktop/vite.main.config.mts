import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig(({ mode }) => {
  // The web app the window loads: apps/web's dev server in development
  // (its port is pinned in apps/web/vite.config.ts), the deployed web app
  // in a packaged build, read from SEXTOU_WEB_URL when it is packaged.
  const webAppURL =
    mode === 'development'
      ? 'http://localhost:5173'
      : (process.env.SEXTOU_WEB_URL ?? '');
  // Over http, anyone on the network could swap the code the window runs.
  // An unset URL still packages: the build opens on its error page.
  if (
    mode !== 'development' &&
    webAppURL !== '' &&
    URL.parse(webAppURL)?.protocol !== 'https:'
  ) {
    throw new Error(
      `SEXTOU_WEB_URL must be an https URL to package the desktop app, got "${webAppURL}".`,
    );
  }
  return {
    define: {
      SEXTOU_WEB_URL: JSON.stringify(webAppURL),
    },
  };
});
