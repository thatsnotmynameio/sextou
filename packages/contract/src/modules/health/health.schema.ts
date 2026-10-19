import { z } from 'zod';

// GET /health: the server's version and how long it has been up.
export const healthResponseSchema = z.object({
  version: z.string(),
  uptimeSeconds: z.number().int().nonnegative(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
