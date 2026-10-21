import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { linguiMacros } from '@sextou/ui/lingui-macros';
import { contentSecurityPolicy } from './content-security-policy';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react(), linguiMacros(), tailwindcss(), contentSecurityPolicy()],
  // The desktop app loads this dev server in development (apps/desktop/vite.main.config.mts).
  server: { port: 5173, strictPort: true },
});
