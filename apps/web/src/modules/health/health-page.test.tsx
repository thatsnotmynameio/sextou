import { render, screen } from '@testing-library/react';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { createAppRouter } from '../../router';

const serverUrl = 'http://server.test';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// The app at /, with fetch answering as `respond` says.
function renderHome(respond: (url: string) => Promise<Response>) {
  const fetch = vi.fn((input: RequestInfo | URL) => respond(String(input)));
  vi.stubGlobal('fetch', fetch);
  const router = createAppRouter({
    serverUrl,
    requestTimeoutMs: 1000,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  return fetch;
}

function healthy(database: 'up' | 'down') {
  return async () =>
    json([{ result: { data: { version: '1.2.3', database } } }]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('the health page asks the server at its URL', async () => {
  const fetch = renderHome(healthy('up'));

  await screen.findByText('1.2.3');

  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toMatch(
    /^http:\/\/server\.test\/trpc\/health\.check\?batch=1&/,
  );
});

// Covers AE1.
test('the health page shows the version and the database up', async () => {
  renderHome(healthy('up'));

  expect(await screen.findByText('1.2.3')).toBeInTheDocument();
  expect(screen.getByText('Database')).toBeInTheDocument();
  expect(screen.getByText('up')).toBeInTheDocument();
});

// Covers AE2.
test('the health page shows the version and the database down', async () => {
  renderHome(healthy('down'));

  expect(await screen.findByText('1.2.3')).toBeInTheDocument();
  expect(screen.getByText('down')).toBeInTheDocument();
});

// Covers AE3.
test.each([
  ['the connection fails', new TypeError('fetch failed')],
  [
    'the request times out',
    new DOMException('The operation timed out.', 'TimeoutError'),
  ],
])(
  'the health page says the server can’t be reached when %s',
  async (_, error) => {
    renderHome(() => Promise.reject(error));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The server can’t be reached.',
    );
  },
);

test('the health page says the server can’t be reached when something else answers', async () => {
  renderHome(
    async () =>
      new Response('<!doctype html><title>Not Found</title>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      }),
  );

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The server can’t be reached.',
  );
});

// Covers AE4 and AE6.
test('the health page says the server answered with an error, and shows no health', async () => {
  renderHome(async () =>
    json(
      [
        {
          error: {
            message: 'Output validation failed',
            code: -32603,
            data: {
              code: 'INTERNAL_SERVER_ERROR',
              httpStatus: 500,
              path: 'health.check',
            },
          },
        },
      ],
      500,
    ),
  );

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The server answered with an error and couldn’t report its health.',
  );
  expect(screen.queryByText('Version')).not.toBeInTheDocument();
  expect(screen.queryByText('Database')).not.toBeInTheDocument();
});

test('the health page shows that it is checking while the server hasn’t answered', async () => {
  renderHome(() => new Promise(() => {}));

  expect(await screen.findByText('Checking the server…')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
