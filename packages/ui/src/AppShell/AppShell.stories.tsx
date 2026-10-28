import type { Meta, StoryObj } from '@storybook/react-vite';
import { Trans } from '@lingui/react/macro';
import {
  Folder,
  House,
  Inbox,
  ListTodo,
  Plus,
  Server,
  Workflow,
} from 'lucide-react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { AppShell } from './AppShell';

const meta = {
  component: AppShell,
  parameters: { layout: 'fullscreen' },
  args: {
    brand: 'sextou',
    sections: [
      {
        links: [
          { label: <Trans>Home</Trans>, href: '#home', icon: House },
          { label: <Trans>Inbox</Trans>, href: '#inbox', icon: Inbox },
        ],
      },
      {
        title: <Trans>Organization</Trans>,
        links: [
          {
            label: <Trans>Tasks</Trans>,
            href: '#tasks',
            icon: ListTodo,
            current: true,
          },
          { label: <Trans>Runners</Trans>, href: '#runners', icon: Server },
          {
            label: <Trans>Workflows</Trans>,
            href: '#workflows',
            icon: Workflow,
          },
        ],
      },
      {
        title: <Trans>Workspaces</Trans>,
        links: [
          { label: 'app-web', href: '#app-web', icon: Folder },
          { label: 'api', href: '#api', icon: Folder },
        ],
      },
    ],
    title: <Trans>Tasks</Trans>,
    actions: (
      <button type="button" className="btn btn-sm btn-primary">
        <Plus aria-hidden="true" size={16} />
        <Trans>New task</Trans>
      </button>
    ),
    footer: (
      <>
        <span>
          <Trans>2 runners connected</Trans>
        </span>
        <span className="font-mono">lease 30000 ms</span>
      </>
    ),
    children: (
      <p className="text-base-content/70">
        <Trans>Each page renders here.</Trans>
      </p>
    ),
  },
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

// On a large screen the navigation stays beside the page, with no button to open it.
export const Desktop: Story = {
  play: async ({ canvas }) => {
    const nav = canvas.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav).toBeVisible();
    await expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Home',
      'Inbox',
      'Tasks',
      'Runners',
      'Workflows',
      'app-web',
      'api',
    ]);
    await expect(
      canvas.queryByRole('button', { name: 'Open navigation' }),
    ).not.toBeInTheDocument();
    await expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Tasks',
    );
    await expect(canvas.getByRole('contentinfo')).toBeVisible();
  },
};

// The page's text uses Source Sans 3 and the footer's code JetBrains Mono.
export const Fonts: Story = {
  play: async ({ canvas }) => {
    await expect(getComputedStyle(canvas.getByRole('main')).fontFamily).toMatch(
      /^"Source Sans 3 Variable"/,
    );
    await expect(
      getComputedStyle(canvas.getByText('lease 30000 ms')).fontFamily,
    ).toMatch(/^"JetBrains Mono Variable"/);
  },
};

// Without actions or a footer the header holds only the title.
export const Bare: Story = {
  args: { actions: undefined, footer: undefined },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('contentinfo')).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole('button', { name: 'New task' }),
    ).not.toBeInTheDocument();
  },
};

// On a phone the navigation hides behind the header's button and covers the
// page once open, until the overlay, Escape or a followed link closes it.
export const Phone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  // Following a link would move the test runner's page away; the shell still sees the click.
  decorators: [
    (Story) => (
      <div onClickCapture={(event) => event.preventDefault()}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvas, canvasElement, step }) => {
    const open = canvas.getByRole('button', { name: 'Open navigation' });
    // Hidden, the navigation is out of the accessibility tree: reach it through the button it belongs to.
    const nav = canvasElement.ownerDocument.getElementById(
      open.getAttribute('aria-controls') ?? '',
    );
    // daisyUI slides the navigation in and out, so its visibility changes at the end of the transition.
    const opened = async () => {
      await userEvent.click(open);
      await waitFor(() => expect(nav).toBeVisible());
    };
    const closed = () => waitFor(() => expect(nav).not.toBeVisible());

    await expect(nav).not.toBeVisible();
    await step('the button opens it', async () => {
      await opened();
      await expect(
        canvas.getByRole('navigation', { name: 'Main navigation' }),
      ).toBe(nav);
    });
    await step('the overlay closes it', async () => {
      await userEvent.click(
        canvas.getByRole('button', { name: 'Close navigation' }),
      );
      await closed();
    });
    await step('Escape closes it', async () => {
      await opened();
      await userEvent.keyboard('{Escape}');
      await closed();
    });
    await step('a followed link closes it, under a title or not', async () => {
      for (const name of ['Runners', 'Home']) {
        await opened();
        await userEvent.click(canvas.getByRole('link', { name }));
        await closed();
      }
    });
  },
};
