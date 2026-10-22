import type { AppRouter } from '@sextou/server/router';
import { QueryClient } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';

// fetch that gives up once `timeoutMs` pass, keeping the caller's own
// signal: httpBatchLink has no timeout of its own.
export function timeoutFetch(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    return fetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  };
}

// The client for the server at `serverUrl`, and the QueryClient that caches
// its answers. A failed request reaches the error state at once: no retry,
// and no pause while the browser reports itself offline.
export function createTRPC(serverUrl: string, requestTimeoutMs: number) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'always' } },
  });
  const client = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${serverUrl}/trpc`,
        fetch: timeoutFetch(requestTimeoutMs),
      }),
    ],
  });
  return {
    queryClient,
    trpc: createTRPCOptionsProxy<AppRouter>({ client, queryClient }),
  };
}

export type TRPC = ReturnType<typeof createTRPC>['trpc'];
