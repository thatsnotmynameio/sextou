import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import * as icons from './Icon';

const meta = {
  title: 'Icon',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const All: Story = {
  render: () => (
    <ul className="grid grid-cols-4 gap-4 font-sans text-xs text-item">
      {Object.entries(icons).map(([name, Icon]) => (
        <li key={name} className="flex flex-col items-center gap-2">
          <Icon />
          {name}
        </li>
      ))}
    </ul>
  ),
};

export const InheritsColor: Story = {
  render: () => (
    <span data-testid="parent" className="text-accent">
      <icons.HomeIcon />
    </span>
  ),
  play: async ({ canvasElement }) => {
    const parent = within(canvasElement).getByTestId('parent');
    const svg = parent.querySelector('svg');
    if (!svg) {
      throw new Error('HomeIcon rendered no svg');
    }
    await expect(getComputedStyle(svg).stroke).toBe(
      getComputedStyle(parent).color,
    );
  },
};
