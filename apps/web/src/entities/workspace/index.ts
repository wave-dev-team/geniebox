'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { Workspace, WorkspaceRole } from '@workspace/types';

import { useMe } from '@/entities/session';
import { accountsApi } from '@/shared/api';

export function useWorkspaces() {
  const { data: me } = useMe();
  const client = useQueryClient();
  const key = ['workspaces', me?.id];
  const storageKey = `geniebox:account:${me?.id}`;
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(me),
    queryFn: async ({ signal }) => {
      const workspaces = await accountsApi.list(signal);
      const saved = sessionStorage.getItem(storageKey);
      const activeId = (workspaces.find(({ id }) => id === saved) ?? workspaces[0])?.id;
      return { workspaces, activeId };
    },
  });
  function select(id: string) {
    sessionStorage.setItem(storageKey, id);
    client.setQueryData<typeof query.data>(key, (data) => data && { ...data, activeId: id });
  }
  function activate(account: Workspace) {
    sessionStorage.setItem(storageKey, account.id);
    client.setQueryData<typeof query.data>(key, (data) => ({
      activeId: account.id,
      workspaces: [...(data?.workspaces ?? []).filter((item) => item.id !== account.id), account],
    }));
    void client.invalidateQueries({ queryKey: key });
  }
  const active = query.data?.workspaces.find(({ id }) => id === query.data.activeId);
  return { ...query, select, activate, active };
}

export function useProjects(accountId?: string) {
  return useQuery({
    queryKey: ['projects', accountId],
    enabled: Boolean(accountId),
    queryFn: ({ signal }) => accountsApi.projects(accountId!, signal),
  });
}

export function preferredProject<T extends { id: string }>(
  projects: T[] | undefined,
  accountId: string | undefined,
) {
  const saved =
    accountId && typeof window !== 'undefined'
      ? sessionStorage.getItem(`geniebox:project:${accountId}`)
      : null;
  return projects?.find((project) => project.id === saved) ?? projects?.[0];
}

const ROLE_ORDER: WorkspaceRole[] = ['viewer', 'tech', 'admin', 'owner'];

/** Role matrix of the backend: viewer < tech < admin < owner. */
export function hasRoleAtLeast(role: WorkspaceRole | undefined, minimum: WorkspaceRole) {
  return role !== undefined && ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(minimum);
}

export const accountDescriptionKey = (userId: string, accountId: string) =>
  `geniebox:description:${userId}:${accountId}`;

export function localAccountDescription(userId: string | undefined, accountId: string) {
  try {
    return userId && localStorage.getItem(accountDescriptionKey(userId, accountId));
  } catch {
    return null;
  }
}
