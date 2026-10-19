import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Used by Storybook. Apps consume the sources directly through their own Vite config.
export default defineConfig({
  plugins: [react()],
});
