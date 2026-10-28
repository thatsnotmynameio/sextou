/// <reference types="vite/client" />
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import { render } from '@testing-library/react';
import type { ComponentType } from 'react';
import { MINIMAL_VIEWPORTS } from 'storybook/viewport';
import { expect, test } from 'vitest';
import { page } from 'vitest/browser';
import preview from '../../.storybook/preview';

// Each story as it renders, against its reference image in __screenshots__/:
// a change no play function checks, such as a color or a spacing, fails here.
// Only CI runs it; AGENTS.md says where a new reference comes from.
setProjectAnnotations(preview);

const modules = import.meta.glob<Parameters<typeof composeStories>[0]>(
  '../../src/**/*.stories.tsx',
  { eager: true },
);

type Viewport = { viewport?: { value?: string } };

// The window a story's viewport global asks for, as Storybook's toolbar sizes
// it, or a laptop's for a story that asks for none.
function viewportOf(globals: Viewport) {
  const value = globals.viewport?.value;
  const styles =
    value && value in MINIMAL_VIEWPORTS
      ? MINIMAL_VIEWPORTS[value as keyof typeof MINIMAL_VIEWPORTS].styles
      : { width: '1280px', height: '800px' };
  return { width: parseInt(styles.width), height: parseInt(styles.height) };
}

const stories = Object.entries(modules).flatMap(([path, module]) => {
  const component = /([^/]+)\.stories\.tsx$/.exec(path)?.[1];
  // A composed story is a component with its args and decorators applied,
  // which carries its globals.
  return Object.entries(composeStories(module)).map(([name, composed]) => {
    const Story = composed as ComponentType & { globals: Viewport };
    return [`${component} ${name}`, Story, viewportOf(Story.globals)] as const;
  });
});

test.each(stories)(
  '%s matches its screenshot',
  async (name, Story, { width, height }) => {
    await page.viewport(width, height);
    const { container } = render(<Story />);

    // daisyUI's loading spinner turns through SMIL inside its mask, which no
    // CSS setting stops, so two captures never match: each one is covered
    // with a box of one color instead.
    const spinners = [...container.querySelectorAll('.loading')].map(
      (spinner) => page.elementLocator(spinner),
    );
    await expect
      .element(page.elementLocator(container))
      .toMatchScreenshot(name.replaceAll(' ', '-'), {
        screenshotOptions: { mask: spinners },
      });
  },
);
