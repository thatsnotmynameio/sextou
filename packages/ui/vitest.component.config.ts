import path from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import viteConfig from './vite.config';
import { coverage } from './vitest.config';

// The component suite: every story renders in Chromium and must pass its
// play function. It needs Playwright's Chromium, so the root vitest.config.ts
// leaves it out.
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
      name: 'ui/component',
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
