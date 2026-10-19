import path from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import viteConfig from './vite.config';
import { coverage } from './vitest.config';

// The integration suite: every story renders in Chromium and must pass its
// play function. It needs Playwright's Chromium, so it runs locally only.
export default mergeConfig(
  viteConfig,
  defineConfig({
    plugins: [
      storybookTest({
        configDir: path.join(import.meta.dirname, '.storybook'),
        storybookScript: 'pnpm storybook',
      }),
    ],
    test: {
      name: 'integration',
      browser: {
        enabled: true,
        provider: playwright({}),
        headless: true,
        instances: [{ browser: 'chromium' }],
      },
      coverage,
    },
  }),
);
