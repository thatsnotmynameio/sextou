import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { WorkspaceHeader } from './WorkspaceHeader';

const meta = {
  // Its colors need Storybook's dark background, which the component suite
  // doesn't paint, so axe lists this design's findings without failing it.
  parameters: { a11y: { test: 'todo' } },
  component: WorkspaceHeader,
  args: {
    name: 'Tatu',
    initial: 'T',
    onSwitchWorkspace: fn(),
    onSearch: fn(),
    onNewIssue: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-[212px] font-sans text-[13px]/[1.4] text-text">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkspaceHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('T')).toBeVisible();
    await expect(canvas.getByText('Tatu')).toBeVisible();
    await expect(
      canvas.getByRole('button', { name: 'Switch workspace' }),
    ).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Search' })).toBeVisible();
    await expect(
      canvas.getByRole('button', { name: 'New issue' }),
    ).toBeVisible();
  },
};

export const Clicks: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Search' }));
    await expect(args.onSearch).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByRole('button', { name: 'New issue' }));
    await expect(args.onNewIssue).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByText('T'));
    await userEvent.click(canvas.getByText('Tatu'));
    await expect(args.onSwitchWorkspace).toHaveBeenCalledTimes(2);
  },
};

export const LongName: Story = {
  args: { name: 'Tatu Engineering and Operations' },
  play: async ({ canvas }) => {
    const name = canvas.getByText('Tatu Engineering and Operations');
    const search = canvas.getByRole('button', { name: 'Search' });
    const newIssue = canvas.getByRole('button', { name: 'New issue' });
    const row = name.closest('div');
    if (!row) {
      throw new Error('The name is not inside the header row');
    }
    // The name is cut to fit and both buttons stay on the right, inside the row.
    await expect(name.scrollWidth).toBeGreaterThan(name.clientWidth);
    await expect(name.getBoundingClientRect().right).toBeLessThan(
      search.getBoundingClientRect().left,
    );
    await expect(newIssue.getBoundingClientRect().right).toBeLessThanOrEqual(
      row.getBoundingClientRect().right,
    );
  },
};
