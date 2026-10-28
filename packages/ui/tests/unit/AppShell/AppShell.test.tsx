import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { House, ListTodo, Server } from 'lucide-react';
import { expect, test } from 'vitest';
import { renderWithI18n } from '../../render';
import { AppShell, type AppShellProps } from '../../../src/AppShell/AppShell';

const props: AppShellProps = {
  brand: 'sextou',
  sections: [
    { links: [{ label: 'Home', href: '/', icon: House }] },
    {
      title: 'Organization',
      links: [
        { label: 'Tasks', href: '/tasks', icon: ListTodo, current: true },
        { label: 'Runners', href: '/runners', icon: Server },
      ],
    },
  ],
  title: 'Tasks',
  children: <p>The page</p>,
};

// The checkbox daisyUI's drawer reads to show the navigation on small screens.
function drawerToggle(container: HTMLElement) {
  const toggle = container.querySelector<HTMLInputElement>('.drawer-toggle');
  if (!toggle) {
    throw new Error('AppShell rendered no drawer toggle');
  }
  return toggle;
}

test('AppShell lists the sections in the "Main navigation" landmark, in order, under their titles', () => {
  renderWithI18n(<AppShell {...props} />);
  const nav = screen.getByRole('navigation', { name: 'Main navigation' });
  expect(
    within(nav)
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')]),
  ).toEqual([
    ['Home', '/'],
    ['Tasks', '/tasks'],
    ['Runners', '/runners'],
  ]);
  expect(
    within(nav).getByRole('heading', { name: 'Organization' }),
  ).toBeInTheDocument();
  expect(within(nav).getAllByRole('heading')).toHaveLength(1);
  expect(within(nav).getByText('sextou')).toBeInTheDocument();
});

test('AppShell marks only the current link as the current page', () => {
  renderWithI18n(<AppShell {...props} />);
  const current = screen
    .getByRole('navigation')
    .querySelectorAll('[aria-current="page"]');
  expect(current).toHaveLength(1);
  expect(current[0]).toHaveTextContent('Tasks');
  expect(current[0]).toHaveClass('menu-active');
  expect(screen.getByRole('link', { name: 'Home' })).not.toHaveClass(
    'menu-active',
  );
});

test('AppShell puts the title in the header as the page heading, with the content in main', () => {
  renderWithI18n(<AppShell {...props} />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Tasks');
  expect(screen.getByRole('main')).toHaveTextContent('The page');
});

test('AppShell without actions or a footer has only the button and the title in its header, and no footer', () => {
  renderWithI18n(<AppShell {...props} />);
  expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
  expect(screen.getByRole('banner').children).toHaveLength(2);
});

test('AppShell puts the actions in the header and the footer at the bottom', () => {
  renderWithI18n(
    <AppShell
      {...props}
      actions={<button type="button">New task</button>}
      footer={<span>2 runners connected</span>}
    />,
  );
  expect(screen.getByRole('contentinfo')).toHaveTextContent(
    '2 runners connected',
  );
  expect(
    within(screen.getByRole('banner')).getByRole('button', {
      name: 'New task',
    }),
  ).toBeInTheDocument();
});

test('AppShell opens the navigation from the header button, and says so', async () => {
  const { container } = renderWithI18n(<AppShell {...props} />);
  const open = screen.getByRole('button', { name: 'Open navigation' });
  expect(open).toHaveAttribute('aria-expanded', 'false');
  expect(open).toHaveAttribute(
    'aria-controls',
    screen.getByRole('navigation').id,
  );

  await userEvent.click(open);

  expect(drawerToggle(container)).toBeChecked();
  expect(open).toHaveAttribute('aria-expanded', 'true');
});

test.each([
  [
    'the overlay',
    () =>
      userEvent.click(screen.getByRole('button', { name: 'Close navigation' })),
  ],
  [
    'a link under a title',
    () => userEvent.click(screen.getByRole('link', { name: 'Runners' })),
  ],
  [
    'a link with no title',
    () => userEvent.click(screen.getByRole('link', { name: 'Home' })),
  ],
  [
    'Escape',
    async () => {
      fireEvent.keyDown(screen.getByRole('navigation'), { key: 'Escape' });
    },
  ],
])('AppShell closes the open navigation on %s', async (_, close) => {
  const { container } = renderWithI18n(<AppShell {...props} />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Open navigation' }),
  );

  await close();

  expect(drawerToggle(container)).not.toBeChecked();
});

test('AppShell keeps the navigation open on another key', async () => {
  const { container } = renderWithI18n(<AppShell {...props} />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Open navigation' }),
  );

  fireEvent.keyDown(screen.getByRole('navigation'), { key: 'Enter' });

  expect(drawerToggle(container)).toBeChecked();
});
