import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { linguiMacros } from './lingui-macros';

// Used by Storybook. Apps consume the sources directly through their own Vite config.
export default defineConfig({
  plugins: [react(), linguiMacros(), tailwindcss()],
});
