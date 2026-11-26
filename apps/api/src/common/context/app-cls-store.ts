import type { ClsStore } from 'nestjs-cls';

import type { AccountRole } from '../auth/account-role.js';

/**
 * Per-request / per-job context. Populated by guards (from verified tokens and membership
 * checks) or by queue processors (from validated payloads) before any service code runs —
 * never from request body or query. The trace id is the CLS id (`cls.getId()`).
 */
export interface AppClsStore extends ClsStore {
  accountId?: string;
  userId?: string;
  sessionId?: string;
  /** Role of `userId` in `accountId`, resolved by AccountAccessGuard. */
  accountRole?: AccountRole;
  /** Project of the request, resolved by ProjectAccessGuard inside `accountId`. */
  projectId?: string;
}
