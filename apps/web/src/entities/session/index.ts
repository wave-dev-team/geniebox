'use client';

import { useQuery } from '@tanstack/react-query';

import { ApiError, profileApi, queryKeys } from '@/shared/api';

export { describeUserAgent } from './model/user-agent';
export type { Session as UserSession } from '@workspace/types';

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me(),
    queryFn: async ({ signal }) => {
      try {
        return await profileApi.me(signal);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
  });
}

export function useSessions() {
  return useQuery({ queryKey: queryKeys.sessions(), queryFn: profileApi.sessions });
}
