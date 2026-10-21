import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { HomeIcon, InboxIcon, QueueIcon, ReviewsIcon } from '../Icon/Icon';
import { renderWithI18n } from '../test/render';
import { Sidebar, type SidebarProps } from './Sidebar';

const props: SidebarProps = {
  workspace: { name: 'Tatu', initial: 'T' },
  items: [
    { icon: HomeIcon, label: 'Home', href: '#' },
    { icon: InboxIcon, label: 'Inbox', href: '#', badge: 4 },
    { icon: ReviewsIcon, label: 'Reviews', href: '#', count: 3 },
  ],
  sections: [
    {
      title: 'Organization',
      items: [{ icon: QueueIcon, label: 'Queue', href: '#', active: true }],
    },
  ],
};

test('Sidebar is the "Main navigation" landmark with the header, items and sections in order', () => {
  renderWithI18n(<Sidebar {...props} />);
  const nav = screen.getByRole('navigation', { name: 'Main navigation' });
  expect(
    within(nav).getByRole('button', { name: 'Switch workspace' }),
  ).toBeInTheDocument();
  expect(
    within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual(['Home', 'Inbox4', 'Reviews3', 'Queue']);
  expect(within(nav).getByText('Organization')).toBeInTheDocument();
  const current = nav.querySelectorAll('[aria-current="page"]');
  expect(current).toHaveLength(1);
  expect(current[0]).toHaveTextContent('Queue');
});

test('Sidebar renders only the header and the top items when there are no sections', () => {
  renderWithI18n(<Sidebar {...props} sections={[]} />);
  const nav = screen.getByRole('navigation');
  expect(nav.children).toHaveLength(2);
  expect(within(nav).getAllByRole('link')).toHaveLength(3);
});
