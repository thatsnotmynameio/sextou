import { z } from 'zod';

// GET /health: the server's version, how long it has been up, and whether its
// database answers.
export const healthResponseSchema = z.object({
  version: z.string(),
  uptimeSeconds: z.number().int().nonnegative(),
  database: z.enum(['up', 'down']),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
