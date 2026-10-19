import type { Meta, StoryObj } from '@storybook/react-vite';
import { Trans } from '@lingui/react/macro';
import { expect, fn, within } from 'storybook/test';
import {
  ActorsIcon,
  CatalogIcon,
  CyclesIcon,
  FolderIcon,
  HomeIcon,
  InboxIcon,
  InitiativesIcon,
  MetricsIcon,
  MyQueueIcon,
  ProjectsIcon,
  QueueIcon,
  RepositoryIcon,
  ReviewsIcon,
  RoadmapIcon,
} from '../Icon/Icon';
import { Sidebar, type SidebarProps } from './Sidebar';

// The design's "Tatu" workspace, with either Queue or Reviews as the current page.
function tatu(current: 'queue' | 'reviews'): SidebarProps {
  return {
    workspace: {
      name: 'Tatu',
      initial: 'T',
      onSwitchWorkspace: fn(),
      onSearch: fn(),
      onNewIssue: fn(),
    },
    items: [
      { icon: HomeIcon, label: <Trans>Home</Trans>, href: '#' },
      { icon: InboxIcon, label: <Trans>Inbox</Trans>, href: '#', badge: 4 },
      { icon: MyQueueIcon, label: <Trans>My queue</Trans>, href: '#' },
      {
        icon: ReviewsIcon,
        label: <Trans>Reviews</Trans>,
        href: '#',
        count: 3,
        active: current === 'reviews',
      },
    ],
    sections: [
      {
        title: <Trans>Organization</Trans>,
        items: [
          {
            icon: QueueIcon,
            label: <Trans>Queue</Trans>,
            href: '#',
            active: current === 'queue',
          },
          {
            icon: InitiativesIcon,
            label: <Trans>Initiatives</Trans>,
            href: '#',
          },
          { icon: ProjectsIcon, label: <Trans>Projects</Trans>, href: '#' },
          { icon: RoadmapIcon, label: <Trans>Roadmap</Trans>, href: '#' },
          { icon: CyclesIcon, label: <Trans>Cycles</Trans>, href: '#' },
          { icon: ActorsIcon, label: <Trans>Actors</Trans>, href: '#' },
          { icon: MetricsIcon, label: <Trans>Metrics</Trans>, href: '#' },
        ],
      },
      {
        title: <Trans>Workspaces</Trans>,
        items: [
          { icon: RepositoryIcon, label: 'app-web', href: '#' },
          { icon: RepositoryIcon, label: 'api', href: '#' },
          { icon: FolderIcon, label: <Trans>Contracts</Trans>, href: '#' },
          { icon: FolderIcon, label: <Trans>Finance</Trans>, href: '#' },
        ],
      },
      {
        title: <Trans>Stacks</Trans>,
        items: [
          { icon: CatalogIcon, label: <Trans>Catalog</Trans>, href: '#' },
        ],
      },
    ],
  };
}

const meta = {
  component: Sidebar,
  args: tatu('queue'),
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tatu: Story = {
  play: async ({ canvas }) => {
    const nav = canvas.getByRole('navigation', { name: 'Main navigation' });
    const texts = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent);
    await expect(texts).toEqual([
      'Home',
      'Inbox4',
      'My queue',
      'Reviews3',
      'Queue',
      'Initiatives',
      'Projects',
      'Roadmap',
      'Cycles',
      'Actors',
      'Metrics',
      'app-web',
      'api',
      'Contracts',
      'Finance',
      'Catalog',
    ]);
    for (const title of ['Organization', 'Workspaces', 'Stacks']) {
      await expect(within(nav).getByText(title)).toBeVisible();
    }
    const current = nav.querySelectorAll<HTMLElement>('[aria-current="page"]');
    await expect(current).toHaveLength(1);
    await expect(current[0]).toHaveTextContent('Queue');
  },
};

export const ReviewsActive: Story = {
  args: tatu('reviews'),
  play: async ({ canvas }) => {
    const current = canvas
      .getByRole('navigation')
      .querySelectorAll<HTMLElement>('[aria-current="page"]');
    await expect(current).toHaveLength(1);
    await expect(current[0]).toHaveTextContent('Reviews3');
    // The count turns from grey to the badge's purple.
    await expect(within(current[0]).getByText('3')).toHaveStyle({
      color: 'rgb(220, 191, 255)',
    });
  },
};

export const NoSections: Story = {
  args: { sections: [] },
  play: async ({ canvas }) => {
    const nav = canvas.getByRole('navigation');
    // Only the header and the top items, with nothing after them.
    await expect(nav.children).toHaveLength(2);
    await expect(within(nav).getAllByRole('link')).toHaveLength(4);
  },
};
