// The API: each module's router under the module's name. The web app imports
// only the type, through the package's "./router" export.
import { healthRouter } from './modules/health/index';
import { router } from './trpc';

export const appRouter = router({
  health: healthRouter,
});

export type AppRouter = typeof appRouter;
