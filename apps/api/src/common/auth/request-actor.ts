import type { Request } from 'express';

import type { Actor } from '../../modules/auth/session.store.js';

export type WorkspaceActor = Actor & { homeTenantId: string };
export type AuthenticatedRequest = Request & { user: WorkspaceActor };

export function homeActor({ homeTenantId, userId, sessionId }: WorkspaceActor): Actor {
  return { tenantId: homeTenantId, userId, sessionId };
}
