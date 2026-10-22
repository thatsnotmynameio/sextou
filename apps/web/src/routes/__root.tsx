import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import type { RouterContext } from '../router';

// The layout every page shares.
export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <main className="min-h-screen bg-raised p-8 text-text">
      <Outlet />
    </main>
  ),
});
