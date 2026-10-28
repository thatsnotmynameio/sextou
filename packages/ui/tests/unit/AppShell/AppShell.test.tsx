import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { House, ListTodo, Server } from 'lucide-react';
import { act } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
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

// window.matchMedia, which jsdom lacks, for a screen whose width the test sets.
let large = false;
const changes = new Set<() => void>();
beforeEach(() => {
  large = false;
  changes.clear();
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() {
      return large && query === '(min-width: 64rem)';
    },
    addEventListener: (_: string, listener: () => void) =>
      changes.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      changes.delete(listener),
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function resize(toLarge: boolean) {
  large = toLarge;
  act(() => {
    for (const change of changes) {
      change();
    }
  });
}

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

test('AppShell moves focus into the navigation when it opens', async () => {
  renderWithI18n(<AppShell {...props} />);

  await userEvent.click(
    screen.getByRole('button', { name: 'Open navigation' }),
  );

  expect(screen.getByRole('navigation')).toHaveFocus();
});

test('AppShell returns focus to the button that opened the navigation when it closes', async () => {
  renderWithI18n(<AppShell {...props} />);
  const open = screen.getByRole('button', { name: 'Open navigation' });
  await userEvent.click(open);

  fireEvent.keyDown(screen.getByRole('navigation'), { key: 'Escape' });

  expect(open).toHaveFocus();
});

test('AppShell moves focus into the navigation once its transition ends, when it could not before', async () => {
  renderWithI18n(<AppShell {...props} />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Open navigation' }),
  );
  const nav = screen.getByRole('navigation');
  nav.blur();

  fireEvent.transitionEnd(nav);

  expect(nav).toHaveFocus();
});

test('AppShell leaves focus on a navigation link when the transition ends', async () => {
  renderWithI18n(<AppShell {...props} />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Open navigation' }),
  );
  const runners = screen.getByRole('link', { name: 'Runners' });
  runners.focus();

  fireEvent.transitionEnd(screen.getByRole('navigation'));

  expect(runners).toHaveFocus();
});

test('AppShell leaves focus alone when the closed navigation ends a transition', () => {
  renderWithI18n(<AppShell {...props} />);

  fireEvent.transitionEnd(screen.getByRole('navigation', { hidden: true }));

  expect(document.body).toHaveFocus();
});

test('AppShell leaves focus alone on the first render', () => {
  renderWithI18n(<AppShell {...props} />);
  expect(document.body).toHaveFocus();
});

test('AppShell makes the page inert only while the navigation covers it', async () => {
  renderWithI18n(<AppShell {...props} />);
  const page = screen.getByRole('main').parentElement;
  expect(page).not.toHaveAttribute('inert');

  await userEvent.click(
    screen.getByRole('button', { name: 'Open navigation' }),
  );
  expect(page).toHaveAttribute('inert');

  fireEvent.keyDown(screen.getByRole('navigation'), { key: 'Escape' });
  expect(page).not.toHaveAttribute('inert');
});

test('AppShell closes the open navigation when the screen grows to lg', async () => {
  const { container } = renderWithI18n(<AppShell {...props} />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Open navigation' }),
  );

  resize(true);

  expect(drawerToggle(container)).not.toBeChecked();
});

test('AppShell keeps the navigation open when the screen changes but stays below lg', async () => {
  const { container } = renderWithI18n(<AppShell {...props} />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Open navigation' }),
  );

  resize(false);

  expect(drawerToggle(container)).toBeChecked();
});

test('AppShell watches the screen only while the navigation is open', async () => {
  renderWithI18n(<AppShell {...props} />);
  expect(changes.size).toBe(0);
  await userEvent.click(
    screen.getByRole('button', { name: 'Open navigation' }),
  );
  expect(changes.size).toBe(1);

  fireEvent.keyDown(screen.getByRole('navigation'), { key: 'Escape' });

  expect(changes.size).toBe(0);
});
