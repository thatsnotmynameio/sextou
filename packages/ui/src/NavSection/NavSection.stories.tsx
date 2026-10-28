import type { Meta, StoryObj } from '@storybook/react-vite';
import { Trans } from '@lingui/react/macro';
import { expect, within } from 'storybook/test';
import {
  ActorsIcon,
  CyclesIcon,
  InitiativesIcon,
  MetricsIcon,
  ProjectsIcon,
  QueueIcon,
  RoadmapIcon,
} from '../Icon/Icon';
import { NavSection } from './NavSection';

const meta = {
  // Its colors need Storybook's dark background, which the component suite
  // doesn't paint, so axe lists this design's findings without failing it.
  parameters: { a11y: { test: 'todo' } },
  component: NavSection,
  decorators: [
    (Story) => (
      <div className="w-[212px] font-sans text-[13px]/[1.4] text-text">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NavSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Organization: Story = {
  args: {
    title: <Trans>Organization</Trans>,
    items: [
      { icon: QueueIcon, label: <Trans>Queue</Trans>, href: '#', active: true },
      { icon: InitiativesIcon, label: <Trans>Initiatives</Trans>, href: '#' },
      { icon: ProjectsIcon, label: <Trans>Projects</Trans>, href: '#' },
      { icon: RoadmapIcon, label: <Trans>Roadmap</Trans>, href: '#' },
      { icon: CyclesIcon, label: <Trans>Cycles</Trans>, href: '#' },
      { icon: ActorsIcon, label: <Trans>Actors</Trans>, href: '#' },
      { icon: MetricsIcon, label: <Trans>Metrics</Trans>, href: '#' },
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Organization')).toBeVisible();
    const links = within(canvas.getByRole('list')).getAllByRole('link');
    await expect(links.map((link) => link.textContent)).toEqual([
      'Queue',
      'Initiatives',
      'Projects',
      'Roadmap',
      'Cycles',
      'Actors',
      'Metrics',
    ]);
  },
};
