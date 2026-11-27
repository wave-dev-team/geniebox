export {
  accountsApi,
  agentsApi,
  ApiError,
  authApi,
  connectionsApi,
  listConnectionProviders,
  listOnboardingAgents,
  membersApi,
  metricsApi,
  profileApi,
  projectChat,
  projectOperations,
  projectsApi,
  reportsApi,
  routinesApi,
  tasksApi,
} from '@workspace/api-client';

export const queryKeys = {
  me: () => ['profile'] as const,
  sessions: () => ['profile', 'sessions'] as const,
};

// The retained business screens use the previous API contract. Enable each when its adapter is migrated.
export const businessApiAvailable = false;
