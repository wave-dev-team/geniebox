import { type HealthResponse, healthResponseSchema } from '@workspace/types';

import { request } from './request.js';

export { accountsApi } from './accounts.js';
export { projectChat } from './chat.js';
export { authApi, profileApi } from './identity.js';
export type {
  KnowledgeNode,
  KnowledgeProposal,
  KnowledgeRevision,
  KnowledgeSearchResult,
  KnowledgeSource,
  KnowledgeStats,
} from './knowledge.js';
export { knowledgeApi } from './knowledge.js';
export { membersApi, projectsApi } from './projects.js';
export { ApiError } from './request.js';

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return healthResponseSchema.parse(await (await request('/health', { signal })).json());
}

export {
  describeConnectionLink,
  listConnectionProviders,
  listOnboardingAgents,
  projectOperations,
  submitConnectionLink,
} from './project-operations.js';
export { projectWork } from './tasks.js';
