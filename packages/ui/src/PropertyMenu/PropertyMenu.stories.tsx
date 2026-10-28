import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import {
  Bot,
  CircleAlert,
  GitBranch,
  SignalHigh,
  SignalMedium,
  Workflow,
} from 'lucide-react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { PropertyMenu, type PropertyMenuProps } from './PropertyMenu';

// The menu keeps the value it was given; the story's own state lets the pill show the one chosen.
function Stateful<T extends string | number>(props: PropertyMenuProps<T>) {
  const [value, setValue] = useState(props.value);
  return (
    <PropertyMenu
      {...props}
      value={value}
      onChange={(chosen) => {
        setValue(chosen);
        props.onChange(chosen);
      }}
    />
  );
}

const meta = {
  component: PropertyMenu<number>,
  render: (args) => <Stateful {...args} />,
  args: {
    name: 'Priority',
    icon: SignalMedium,
    options: [
      { value: 0, label: 'P0 · Critical', icon: CircleAlert },
      { value: 1, label: 'P1 · Urgent', icon: SignalHigh },
      { value: 2, label: 'P2 · Normal', icon: SignalMedium },
    ],
    value: 2,
    onChange: fn(),
  },
} satisfies Meta<typeof PropertyMenu<number>>;

export default meta;
type Story = StoryObj<typeof meta>;

// The pill names the property and its value; the menu marks the current
// option, and choosing another sets it and closes the menu.
export const Choose: Story = {
  play: async ({ args, canvas, canvasElement }) => {
    const pill = canvas.getByRole('button', { name: 'Priority P2 · Normal' });
    const menu = canvasElement.ownerDocument.getElementById(
      pill.getAttribute('popovertarget') ?? '',
    );
    await expect(menu).not.toBeVisible();

    await userEvent.click(pill);
    await waitFor(() => expect(menu).toBeVisible());
    const list = within(menu as HTMLElement);
    await expect(
      list.getByRole('button', { name: 'P2 · Normal' }),
    ).toHaveAttribute('aria-current', 'true');
    await expect(
      list.getByRole('button', { name: 'P1 · Urgent' }),
    ).not.toHaveAttribute('aria-current');

    await userEvent.click(list.getByRole('button', { name: 'P1 · Urgent' }));

    await expect(args.onChange).toHaveBeenCalledWith(1);
    await waitFor(() => expect(menu).not.toBeVisible());
    await expect(
      canvas.getByRole('button', { name: 'Priority P1 · Urgent' }),
    ).toBeInTheDocument();
  },
};

// Options that explain themselves, each with its text below its name.
export const Described: StoryObj<typeof PropertyMenu<string>> = {
  render: (args) => <Stateful {...args} />,
  args: {
    name: 'Workflow',
    icon: Workflow,
    options: [
      {
        value: 'git/checkout',
        label: 'git/checkout',
        description: 'Clones a repository at a ref, in the workspace.',
        icon: GitBranch,
      },
      {
        value: 'harness/claude-headless',
        label: 'harness/claude-headless',
        description: 'Runs claude -p in the workspace, with the prompt.',
        icon: Bot,
      },
    ],
    value: undefined,
    onChange: fn(),
  },
  play: async ({ canvas, canvasElement }) => {
    const pill = canvas.getByRole('button', { name: 'Workflow' });
    await userEvent.click(pill);
    const menu = canvasElement.ownerDocument.getElementById(
      pill.getAttribute('popovertarget') ?? '',
    ) as HTMLElement;
    await waitFor(() => expect(menu).toBeVisible());
    await expect(
      within(menu).getByText('Clones a repository at a ref, in the workspace.'),
    ).toBeVisible();
  },
};

// A property a submit found missing says so on its pill.
export const Invalid: Story = {
  args: { value: undefined, invalid: true },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole('button', { name: 'Priority missing' }),
    ).toHaveClass('border-error');
  },
};
