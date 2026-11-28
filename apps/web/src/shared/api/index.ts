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
  describeConnectionLink,
  knowledgeApi,
  listConnectionProviders,
  listOnboardingAgents,
  membersApi,
  profileApi,
  projectChat,
  projectOperations,
  projectsApi,
  projectWork,
  submitConnectionLink,
} from '@workspace/api-client';

export const queryKeys = {
  me: () => ['profile'] as const,
  sessions: () => ['profile', 'sessions'] as const,
};
