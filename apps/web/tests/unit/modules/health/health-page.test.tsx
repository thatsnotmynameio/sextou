import { render, screen } from '@testing-library/react';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { delay, http, HttpResponse, type HttpResponseResolver } from 'msw';
import { expect, test } from 'vitest';
import { createAppRouter } from '../../../../src/router';
import { network, setUpNetwork } from '../../../network';

const serverUrl = 'http://server.test';
const healthCheck = `${serverUrl}/trpc/health.check`;

setUpNetwork();

// The app at /, with the server's health.check answering as `answer` says.
function renderHome(answer: HttpResponseResolver, requestTimeoutMs = 1000) {
  network.use(http.get(healthCheck, answer));
  const router = createAppRouter({
    serverUrl,
    requestTimeoutMs,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
}

function healthy(database: 'up' | 'down') {
  return () =>
    HttpResponse.json([{ result: { data: { version: '1.2.3', database } } }]);
}

test('the health page asks the server at its URL, as a tRPC batch', async () => {
  const asked: URL[] = [];
  renderHome(({ request }) => {
    asked.push(new URL(request.url));
    return healthy('up')();
  });

  await screen.findByText('1.2.3');

  expect(asked).toHaveLength(1);
  expect(asked[0].searchParams.get('batch')).toBe('1');
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
test('the health page says the server can’t be reached when the connection fails', async () => {
  renderHome(() => HttpResponse.error());

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The server can’t be reached.',
  );
});

// Covers AE3 through the client's own timeout: the server never answers.
// Real timers: fake ones don't fire AbortSignal.timeout.
test('the health page says the server can’t be reached once the request timeout passes', async () => {
  renderHome(async () => {
    await delay('infinite');
    return HttpResponse.json([]);
  }, 20);

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The server can’t be reached.',
  );
});

test('the health page says the server can’t be reached when something else answers', async () => {
  renderHome(() =>
    HttpResponse.html('<!doctype html><title>Not Found</title>', {
      status: 404,
    }),
  );

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The server can’t be reached.',
  );
});

// Covers AE4 and AE6.
test('the health page says the server answered with an error, and shows no health', async () => {
  renderHome(() =>
    HttpResponse.json(
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
      { status: 500 },
    ),
  );

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The server answered with an error and couldn’t report its health.',
  );
  expect(screen.queryByText('Version')).not.toBeInTheDocument();
  expect(screen.queryByText('Database')).not.toBeInTheDocument();
});

test('the health page shows that it is checking while the server hasn’t answered', async () => {
  renderHome(async () => {
    await delay('infinite');
    return HttpResponse.json([]);
  });

  expect(await screen.findByText('Checking the server…')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
