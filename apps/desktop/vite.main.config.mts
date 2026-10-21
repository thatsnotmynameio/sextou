import { defineConfig, loadEnv } from 'vite';

// https://vitejs.dev/config
export default defineConfig(({ mode }) => {
  // The web app the window loads, from SEXTOU_WEB_URL. In development it
  // falls back to apps/web's dev server, and apps/desktop/.env can set it,
  // since neither Vite nor Forge puts .env into process.env for this file.
  // A packaged build reads only the environment it is packaged in, so a
  // development .env never reaches a release.
  const webAppURL =
    mode === 'development'
      ? loadEnv(mode, import.meta.dirname, 'SEXTOU_').SEXTOU_WEB_URL ||
        'http://localhost:5173'
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
