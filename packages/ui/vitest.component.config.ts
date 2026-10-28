import path from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import viteConfig from './vite.config';
import { coverage } from './vitest.config';

// Chromium for a project: each project needs objects of its own.
function chromium() {
  return {
    enabled: true,
    provider: playwright({}),
    headless: true,
    instances: [{ browser: 'chromium' as const }],
  };
}

// Each story against its reference image, in tests/component/. Text renders a
// pixel or two apart from one Linux to another, so the references are this CI
// runner's Ubuntu and only CI (CI=true) compares them; a run elsewhere leaves
// them out.
const screenshots = {
  extends: true,
  test: {
    name: 'ui/screenshots',
    include: ['tests/component/**/*.test.tsx'],
    // The unit suite's setup: English, and each story unmounted after its
    // test, so no story's pixels depend on the ones rendered before it.
    setupFiles: ['./vitest.setup.ts'],
    fsModuleCachePath: 'node_modules/.vitest-cache',
    browser: chromium(),
  },
};

// The component suite, in Chromium: every story must pass its play function
// and axe, and, in CI, match its screenshot. It needs Playwright's Chromium, so
// the root vitest.config.ts leaves it out. The stories and the screenshots are
// two projects, since the Storybook plugin sets the files its project runs; the
// suite's coverage covers both.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      coverage,
      projects: [
        {
          extends: true,
          plugins: [
            storybookTest({
              configDir: path.join(import.meta.dirname, '.storybook'),
              storybookScript: 'pnpm storybook',
            }),
          ],
          test: {
            name: 'ui/component',
            // This package's own module cache, as vitest.config's comment explains.
            fsModuleCachePath: 'node_modules/.vitest-cache',
            browser: chromium(),
          },
        },
        ...(process.env.CI === 'true' ? [screenshots] : []),
      ],
    },
  }),
);
