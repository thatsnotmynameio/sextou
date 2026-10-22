import { z } from 'zod';

// What runner.next answers. There is no task to hand out yet, so task is
// always null; a task's own shape comes with the runner that executes one.
export const nextSchema = z.object({
  task: z.null(),
});
