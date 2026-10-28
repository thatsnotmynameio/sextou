import { render, screen, within } from '@testing-library/react';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { createAppRouter } from '../../../src/router';

const serverUrl = 'http://server.test';

// The app at `path`, with a server that never answers: the layout doesn't wait for it.
function renderAt(path: string) {
  vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
  const router = createAppRouter({
    serverUrl,
    requestTimeoutMs: 1000,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('the layout heads the page with the title its route declares', async () => {
  renderAt('/');

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Server health' }),
  ).toBeInTheDocument();
});

test('the layout marks the current page in the navigation', async () => {
  renderAt('/');

  const nav = await screen.findByRole('navigation', {
    name: 'Main navigation',
  });
  const link = within(nav).getByRole('link', { name: 'Server health' });
  expect(link).toHaveAttribute('href', '/');
  expect(link).toHaveAttribute('aria-current', 'page');
});

test('the layout names the server the app talks to in its footer', async () => {
  renderAt('/');

  expect(await screen.findByRole('contentinfo')).toHaveTextContent(
    'Server http://server.test',
  );
});

test('the layout heads a page no route matches with the brand, with no current link', async () => {
  renderAt('/missing');

  expect(
    await screen.findByRole('heading', { level: 1, name: 'sextou' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'Server health' }),
  ).not.toHaveAttribute('aria-current');
});
