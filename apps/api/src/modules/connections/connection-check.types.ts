import { z } from 'zod';

import type { CheckReason } from './providers/provider.types.js';

/** Queue payload: ids only, never secret values. */
export const connectionCheckJobSchema = z.object({
  connectionId: z.uuid(),
  accountId: z.uuid(),
  userId: z.uuid().nullable(),
  traceId: z.string().min(1),
});
export type ConnectionCheckJob = z.infer<typeof connectionCheckJobSchema>;

export interface CheckOutcome {
  status: 'ok' | 'warn' | 'error';
  reason: CheckReason | null;
  detail: string | null;
}
