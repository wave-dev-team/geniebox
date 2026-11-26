import { z } from 'zod';

export const healthStatuses = ['ok', 'error', 'shutting_down', 'degraded'] as const;
export const healthResponseSchema = z.object({ status: z.enum(healthStatuses) });

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export * from './agents.js';
export * from './chat.js';
export * from './identity.js';
export * from './tasks.js';
