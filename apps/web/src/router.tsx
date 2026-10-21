import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { createTRPC, type TRPC } from './trpc';

// What every route gets, through Route.useRouteContext().
export interface RouterContext {
  trpc: TRPC;
  queryClient: QueryClient;
}

export interface AppRouterOptions {
  serverUrl: string;
  requestTimeoutMs: number;
  // The browser's address bar when unset; tests pass a memory history.
  history?: RouterHistory;
}

// The app: the routes in src/routes/, with the tRPC client in their context
// and the providers every page needs around them.
export function createAppRouter({
  serverUrl,
  requestTimeoutMs,
  history,
}: AppRouterOptions) {
  const { queryClient, trpc } = createTRPC(serverUrl, requestTimeoutMs);
  return createRouter({
    routeTree,
    history,
    context: { trpc, queryClient },
    Wrap: ({ children }) => (
      <I18nProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </I18nProvider>
    ),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
