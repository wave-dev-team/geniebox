export type {
  KnowledgeNode,
  KnowledgeProposal,
  KnowledgeRevision,
  KnowledgeSearchResult,
  KnowledgeSource,
  KnowledgeStats,
} from '@workspace/api-client';
export {
  accountsApi,
  ApiError,
  authApi,
  connectionsApi,
  knowledgeApi,
  listConnectionProviders,
  listOnboardingAgents,
  membersApi,
  metricsApi,
  profileApi,
  projectChat,
  projectOperations,
  projectsApi,
  projectWork,
  reportsApi,
} from '@workspace/api-client';

export const queryKeys = {
  me: () => ['profile'] as const,
  sessions: () => ['profile', 'sessions'] as const,
};

// The retained business screens use the previous API contract. Enable each when its adapter is migrated.
export const businessApiAvailable = false;
