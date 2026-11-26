export {
  accountsApi,
  agentsApi,
  ApiError,
  authApi,
  chatApi,
  connectionsApi,
  metricsApi,
  profileApi,
  reportsApi,
  routinesApi,
  tasksApi,
} from '@workspace/api-client';

export const queryKeys = {
  me: () => ['profile'] as const,
  sessions: () => ['profile', 'sessions'] as const,
};
