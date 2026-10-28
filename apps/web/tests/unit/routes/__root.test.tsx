import { render, screen, within } from '@testing-library/react';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { delay, http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { createAppRouter } from '../../../src/router';
import { network, setUpNetwork } from '../../network';

const serverUrl = 'http://server.test';

setUpNetwork();

// The app at `path`, with a server that never answers: the layout doesn't wait for it.
function renderAt(path: string) {
  network.use(
    http.get(`${serverUrl}/trpc/*`, async () => {
      await delay('infinite');
      return HttpResponse.json([]);
    }),
  );
  const router = createAppRouter({
    serverUrl,
    requestTimeoutMs: 1000,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
}

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

test('the layout heads a page no route matches with the brand', async () => {
  renderAt('/missing');

  expect(
    await screen.findByRole('heading', { level: 1, name: 'sextou' }),
  ).toBeInTheDocument();
});

test('the layout marks no link current on a page no route matches', async () => {
  renderAt('/missing');

  expect(
    await screen.findByRole('link', { name: 'Server health' }),
  ).not.toHaveAttribute('aria-current');
});
