import { procedure, router } from '../../trpc';
import { nextSchema } from './runner.schema';

export const runnerRouter = router({
  // The task a runner should run next. It answers any caller, and always
  // that there is none.
  next: procedure.output(nextSchema).query(() => ({ task: null })),
});
