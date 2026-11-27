'use client';

import type { ProjectRef } from '@/entities/project/operations';
import { hasRoleAtLeast, preferredProject, useProjects, useWorkspaces } from '@/entities/workspace';

export function useActiveProject() {
  const workspaces = useWorkspaces();
  const account = workspaces.active;
  const projects = useProjects(account?.id);
  const project = preferredProject(projects.data, account?.id);
  const projectRef: ProjectRef | undefined =
    account && project ? { accountId: account.id, id: project.id } : undefined;

  return {
    account,
    project,
    projectRef,
    isLoading: workspaces.isLoading || (Boolean(account) && projects.isLoading),
    isError: workspaces.isError || projects.isError,
    canAdmin: hasRoleAtLeast(account?.role, 'admin'),
    canTech: hasRoleAtLeast(account?.role, 'tech'),
  };
}
