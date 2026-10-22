import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { HomeIcon, InboxIcon, ReviewsIcon } from '../../../src/Icon/Icon';
import { NavItem } from '../../../src/NavItem/NavItem';

test('NavItem renders a link with its icon and label, and is not current', () => {
  render(<NavItem icon={HomeIcon} label="Home" href="/home" />);
  const link = screen.getByRole('link', { name: 'Home' });
  expect(link).toHaveAttribute('href', '/home');
  expect(link).not.toHaveAttribute('aria-current');
  expect(link.querySelector('svg')).toHaveClass('text-muted');
  expect(link.textContent).toBe('Home');
});

test('NavItem shows a badge', () => {
  render(<NavItem icon={InboxIcon} label="Inbox" href="#" badge={4} />);
  const badge = within(screen.getByRole('link')).getByText('4');
  expect(badge).toHaveClass('bg-badge');
});

test('NavItem shows a plain count, purple when the item is active', () => {
  const { rerender } = render(
    <NavItem icon={ReviewsIcon} label="Reviews" href="#" count={3} />,
  );
  expect(screen.getByText('3')).toHaveClass('text-count');
  rerender(
    <NavItem icon={ReviewsIcon} label="Reviews" href="#" count={3} active />,
  );
  expect(screen.getByText('3')).toHaveClass('text-badge-text');
});

test('NavItem marks the active item as the current page', () => {
  render(<NavItem icon={HomeIcon} label="Home" href="#" active />);
  const link = screen.getByRole('link', { name: 'Home' });
  expect(link).toHaveAttribute('aria-current', 'page');
  expect(link).toHaveClass('bg-active');
  expect(link.querySelector('svg')).toHaveClass('text-accent');
});

test('NavItem passes anchor props through, such as onClick', async () => {
  const onClick = vi.fn((event: { preventDefault(): void }) =>
    event.preventDefault(),
  );
  render(<NavItem icon={HomeIcon} label="Home" href="#" onClick={onClick} />);
  await userEvent.click(screen.getByRole('link', { name: 'Home' }));
  expect(onClick).toHaveBeenCalledTimes(1);
});
