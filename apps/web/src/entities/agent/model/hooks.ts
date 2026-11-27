'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AgentActionType, ProjectAgent, ProjectAgentDetails } from '@workspace/types';

import { projectAgentsKey, type ProjectRef } from '@/entities/project/operations';
import { projectOperations } from '@/shared/api';

export const projectAgentKey = (project: ProjectRef, agentId: string) =>
  ['project-agent', project.accountId, project.id, agentId] as const;

export const agentStatsKey = (project: ProjectRef, agentId: string) =>
  ['agent-stats', project.accountId, project.id, agentId] as const;

export const agentActionsKey = (
  project: ProjectRef,
  agentId: string,
  period: '7d' | '30d',
  types?: AgentActionType[],
) => ['agent-actions', project.accountId, project.id, agentId, period, types?.join(',') ?? 'all'] as const;

export function useAgent(project: ProjectRef | undefined, agentId: string) {
  return useQuery({
    queryKey: project ? projectAgentKey(project, agentId) : ['project-agent', 'none', agentId],
    enabled: Boolean(project && agentId),
    queryFn: ({ signal }) => projectOperations(project!.accountId, project!.id).agent(agentId, signal),
  });
}

export function useAgentStats(project: ProjectRef | undefined, agentId: string) {
  return useQuery({
    queryKey: project ? agentStatsKey(project, agentId) : ['agent-stats', 'none', agentId],
    enabled: Boolean(project && agentId),
    queryFn: ({ signal }) => projectOperations(project!.accountId, project!.id).agentStats(agentId, signal),
  });
}

export function useAgentActions(
  project: ProjectRef | undefined,
  agentId: string,
  period: '7d' | '30d',
  types?: AgentActionType[],
) {
  return useInfiniteQuery({
    queryKey: project
      ? agentActionsKey(project, agentId, period, types)
      : ['agent-actions', 'none', agentId, period],
    enabled: Boolean(project && agentId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      projectOperations(project!.accountId, project!.id).agentActions(
        agentId,
        { period, types, cursor: pageParam },
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useToggleAgent(project: ProjectRef | undefined) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ agentId, pause }: { agentId: string; pause: boolean }) => {
      const api = projectOperations(project!.accountId, project!.id);
      return pause ? api.pauseAgent(agentId) : api.resumeAgent(agentId);
    },
    onMutate: async ({ agentId, pause }) => {
      if (!project) return;
      const listKey = projectAgentsKey(project);
      const itemKey = projectAgentKey(project, agentId);
      await Promise.all([
        client.cancelQueries({ queryKey: listKey }),
        client.cancelQueries({ queryKey: itemKey }),
      ]);
      const prevList = client.getQueryData<ProjectAgent[]>(listKey);
      const prevItem = client.getQueryData<ProjectAgentDetails>(itemKey);
      const nextStatus = pause ? ('paused' as const) : ('active' as const);

      if (prevList) {
        client.setQueryData<ProjectAgent[]>(
          listKey,
          prevList.map((a) => (a.id === agentId ? { ...a, status: nextStatus } : a)),
        );
      }
      if (prevItem) {
        client.setQueryData<ProjectAgentDetails>(itemKey, { ...prevItem, status: nextStatus });
      }
      return { prevList, prevItem };
    },
    onError: (_err, { agentId }, ctx) => {
      if (!project || !ctx) return;
      if (ctx.prevList) client.setQueryData(projectAgentsKey(project), ctx.prevList);
      if (ctx.prevItem) client.setQueryData(projectAgentKey(project, agentId), ctx.prevItem);
    },
    onSettled: (_data, _err, { agentId }) => {
      if (!project) return;
      void client.invalidateQueries({ queryKey: projectAgentsKey(project) });
      void client.invalidateQueries({ queryKey: projectAgentKey(project, agentId) });
    },
  });
}
