import type { AppRouter } from '@sextou/server/router';
import { createTRPCClient, httpLink } from '@trpc/client';

// fetch that gives up once `timeoutMs` pass, keeping the caller's own
// signal: httpLink has no timeout of its own.
export function timeoutFetch(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    return fetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  };
}

// The client for the server at `serverUrl`. One request per call: the
// runner makes one call at a time, so there is nothing to batch.
export function createClient(serverUrl: string, requestTimeoutMs: number) {
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `${serverUrl}/trpc`,
        fetch: timeoutFetch(requestTimeoutMs),
      }),
    ],
  });
}

export type Client = ReturnType<typeof createClient>;
