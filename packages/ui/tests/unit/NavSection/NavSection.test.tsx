import { render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { CyclesIcon, ProjectsIcon, QueueIcon } from '../../../src/Icon/Icon';
import { NavSection } from '../../../src/NavSection/NavSection';

test('NavSection shows its title above its items, in order', () => {
  render(
    <NavSection
      title="Organization"
      items={[
        { icon: QueueIcon, label: 'Queue', href: '#', active: true },
        { icon: ProjectsIcon, label: 'Projects', href: '#' },
        { icon: CyclesIcon, label: 'Cycles', href: '#' },
      ]}
    />,
  );
  const title = screen.getByText('Organization');
  const list = screen.getByRole('list');
  expect(title.compareDocumentPosition(list)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  expect(title.tagName).toBe('P');
  const links = within(list).getAllByRole('link');
  expect(links.map((link) => link.textContent)).toEqual([
    'Queue',
    'Projects',
    'Cycles',
  ]);
  expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  expect(links[0]).toHaveAttribute('aria-current', 'page');
});
