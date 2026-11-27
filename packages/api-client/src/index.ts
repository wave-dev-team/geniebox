import { type HealthResponse, healthResponseSchema } from '@workspace/types';

import { request } from './request.js';

export { accountsApi } from './accounts.js';
export { agentsApi } from './agents.js';
export { projectChat } from './chat.js';
export { connectionsApi } from './connections.js';
export { authApi, profileApi } from './identity.js';
export { metricsApi, reportsApi } from './metrics.js';
export { membersApi, projectsApi } from './projects.js';
export { ApiError } from './request.js';
export { routinesApi } from './routines.js';

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return healthResponseSchema.parse(await (await request('/health', { signal })).json());
}

export { listConnectionProviders, projectOperations } from './project-operations.js';
export { tasksApi } from './tasks.js';
