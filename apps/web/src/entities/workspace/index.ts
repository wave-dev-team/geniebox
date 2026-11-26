'use client';

import { useQuery } from '@tanstack/react-query';

import { useMe } from '@/entities/session';
import { accountsApi } from '@/shared/api';

export function useWorkspaces() {
  const me = useMe();
  return useQuery({
    queryKey: ['workspaces', me.data?.id, me.data?.tenantId],
    queryFn: ({ signal }) => accountsApi.list(signal),
    enabled: Boolean(me.data),
  });
}
