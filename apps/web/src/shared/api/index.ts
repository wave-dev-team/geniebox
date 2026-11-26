export { accountsApi, ApiError, authApi, chatApi, profileApi, tasksApi } from '@workspace/api-client';

export const queryKeys = {
  me: () => ['profile'] as const,
  sessions: () => ['profile', 'sessions'] as const,
};
