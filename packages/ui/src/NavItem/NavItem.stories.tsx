import type { Meta, StoryObj } from '@storybook/react-vite';
import { Trans } from '@lingui/react/macro';
import { expect, fn, userEvent, within } from 'storybook/test';
import { HomeIcon, InboxIcon, QueueIcon, ReviewsIcon } from '../Icon/Icon';
import { NavItem } from './NavItem';

const meta = {
  component: NavItem,
  args: { icon: HomeIcon, label: <Trans>Home</Trans>, href: '#' },
  decorators: [
    (Story) => (
      <div className="w-[212px] font-sans text-[13px]/[1.4] text-text">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NavItem>;

export default meta;
type Story = StoryObj<typeof NavItem>;

export const Resting: Story = {
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link', { name: 'Home' });
    await expect(link).not.toHaveAttribute('aria-current');
  },
};

export const WithBadge: Story = {
  args: { icon: InboxIcon, label: <Trans>Inbox</Trans>, badge: 4 },
};

export const WithCount: Story = {
  args: { icon: ReviewsIcon, label: <Trans>Reviews</Trans>, count: 3 },
};

export const ActiveWithCount: Story = {
  args: { ...WithCount.args, active: true },
};

export const Active: Story = {
  args: { icon: QueueIcon, label: <Trans>Queue</Trans>, active: true },
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link', { name: 'Queue' });
    await expect(link).toHaveAttribute('aria-current', 'page');
  },
};

export const Clicked: Story = {
  args: { onClick: fn((event) => event.preventDefault()) },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole('link', { name: 'Home' }));
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

// The focus ring follows :focus-visible, which a simulated Tab doesn't trigger:
// press Tab in the canvas to see it.
export const Focused: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('link', { name: 'Home' })).toHaveFocus();
  },
};

export const LongLabel: Story = {
  args: {
    icon: InboxIcon,
    label: <Trans>Messages waiting for a decision from the whole team</Trans>,
    badge: 12,
  },
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link');
    const label = within(link).getByText(/^Messages/);
    const badge = within(link).getByText('12');
    // The label is cut to one line and the badge stays inside the row.
    await expect(label.scrollWidth).toBeGreaterThan(label.clientWidth);
    await expect(label.offsetHeight).toBeLessThan(20);
    await expect(badge.getBoundingClientRect().right).toBeLessThanOrEqual(
      link.getBoundingClientRect().right,
    );
  },
};
