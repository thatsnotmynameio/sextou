import { z } from 'zod';

// What health answers. The server checks its answer against this before
// sending it.
export const healthSchema = z.object({
  version: z.string().min(1),
  database: z.enum(['up', 'down']),
});
