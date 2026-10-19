import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { linguiMacros } from '../../packages/ui/lingui-macros';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react(), linguiMacros(), tailwindcss()],
});
