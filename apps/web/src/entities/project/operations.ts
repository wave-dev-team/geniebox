'use client';

import { useQuery } from '@tanstack/react-query';

import { projectOperations } from '@/shared/api';

export type ProjectRef = { accountId: string; id: string };

export const projectConnectionsKey = ({ accountId, id }: ProjectRef) =>
  ['project-connections', accountId, id] as const;

export function useProjectConnections(project: ProjectRef) {
  return useQuery({
    queryKey: projectConnectionsKey(project),
    queryFn: ({ signal }) => projectOperations(project.accountId, project.id).connections(signal),
  });
}

export function useProjectAgents(project: ProjectRef) {
  return useQuery({
    queryKey: ['project-agents', project.accountId, project.id],
    queryFn: ({ signal }) => projectOperations(project.accountId, project.id).agents(signal),
  });
}
