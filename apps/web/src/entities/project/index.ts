'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  ALWAYS_ASK,
  CLIENT_ADDRESSES,
  CLIENT_DATA_RETENTION_DAYS,
  CLIENT_LANGUAGES,
  CLIENT_TONES,
  CURRENCIES,
  DATE_FORMATS,
  JOURNAL_RETENTION_DAYS,
  MAIN_METRICS,
  NUMBER_FORMATS,
  PROBATION_DAYS,
  type Project,
  PROJECT_SPHERES,
  type ProjectRulesUpdate,
  type ProjectUpdate,
  TRUST_LEVELS,
  TRUST_STREAKS,
  WEEK_STARTS,
} from '@workspace/types';

import { useMe } from '@/entities/session';
import { preferredProject, useProjects, useWorkspaces } from '@/entities/workspace';
import { projectsApi } from '@/shared/api';

export {
  ALWAYS_ASK,
  CLIENT_ADDRESSES,
  CLIENT_DATA_RETENTION_DAYS,
  CLIENT_LANGUAGES,
  CLIENT_TONES,
  CURRENCIES,
  DATE_FORMATS,
  JOURNAL_RETENTION_DAYS,
  MAIN_METRICS,
  NUMBER_FORMATS,
  PROBATION_DAYS,
  PROJECT_SPHERES as SPHERES,
  TRUST_LEVELS,
  TRUST_STREAKS,
  WEEK_STARTS,
};
export type { Project, ProjectRulesUpdate, ProjectUpdate } from '@workspace/types';

export type TrustLevel = Project['defaultTrustLevel'];
export type AlwaysAsk = Project['alwaysAsk'][number];
export type MainMetric = Project['mainMetric'];

/** Formats are shown by example, the same in every language. */
export const NUMBER_FORMAT_EXAMPLE: Record<Project['numberFormat'], string> = {
  space_comma: '1 234,56',
  comma_dot: '1,234.56',
};

export const DATE_FORMAT_EXAMPLE: Record<Project['dateFormat'], string> = {
  'dd.mm.yyyy': '31.12.2026',
  'yyyy-mm-dd': '2026-12-31',
  'mm/dd/yyyy': '12/31/2026',
};

const projectKey = (accountId: string, projectId: string) => ['project', accountId, projectId] as const;
const projectsKey = (accountId: string) => ['projects', accountId] as const;

export function useMyProjects() {
  const { data: me } = useMe();
  return useQuery({
    queryKey: ['my-projects', me?.id],
    enabled: Boolean(me),
    queryFn: ({ signal }) => projectsApi.mine(signal),
  });
}

export function useRefreshProjects() {
  const client = useQueryClient();
  return async (project: Project) => {
    const key = projectsKey(project.accountId);
    await Promise.all([
      client.invalidateQueries({ queryKey: ['my-projects'] }),
      client.invalidateQueries({ queryKey: key }),
    ]);
    await client.cancelQueries({ queryKey: projectKey(project.accountId, project.id) });
    client.setQueryData(projectKey(project.accountId, project.id), project);
  };
}

/** Account, preferred project and its role: the scope of the settings screens. */
export function useActiveProject() {
  const directory = useWorkspaces();
  const projects = useProjects(directory.active?.id);
  const project = preferredProject(projects.data, directory.active?.id);
  return { directory, account: directory.active, project, projects };
}

export function useProject(accountId: string, projectId: string) {
  return useQuery({
    queryKey: projectKey(accountId, projectId),
    queryFn: ({ signal }) => projectsApi.get(accountId, projectId, signal),
    refetchInterval: (query) => (query.state.data?.pausedUntil ? 30_000 : false),
  });
}

function useStoreProject(accountId: string, projectId: string) {
  const client = useQueryClient();
  return (updated: Project) => {
    client.setQueryData(projectKey(accountId, projectId), updated);
    void client.invalidateQueries({ queryKey: projectsKey(accountId) });
  };
}

/** General and security settings, onboarding step (admin and above). */
export function useUpdateProject(accountId?: string, projectId?: string) {
  const store = useStoreProject(accountId ?? '', projectId ?? '');
  return useMutation({
    mutationFn: (body: ProjectUpdate) => projectsApi.update(accountId!, projectId!, body),
    onSuccess: store,
  });
}

/** Rules for agents (tech and above). */
export function useUpdateProjectRules(accountId?: string, projectId?: string) {
  const store = useStoreProject(accountId ?? '', projectId ?? '');
  return useMutation({
    mutationFn: (body: ProjectRulesUpdate) => projectsApi.updateRules(accountId!, projectId!, body),
    onSuccess: store,
  });
}

export function usePauseProject(accountId?: string, projectId?: string) {
  const store = useStoreProject(accountId ?? '', projectId ?? '');
  return useMutation({
    mutationFn: (until?: Date) => projectsApi.pause(accountId!, projectId!, until),
    onSuccess: store,
  });
}

export function useResumeProject(accountId?: string, projectId?: string) {
  const store = useStoreProject(accountId ?? '', projectId ?? '');
  return useMutation({
    mutationFn: () => projectsApi.resume(accountId!, projectId!),
    onSuccess: store,
  });
}

/** Soft delete by the owner; the typed name is checked by the backend as well. */
export function useDeleteProject(accountId: string, projectId: string, onDelete: () => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (confirmName: string) => projectsApi.remove(accountId, projectId, confirmName),
    onSuccess: async () => {
      const key = projectsKey(accountId);
      await client.cancelQueries({ queryKey: key });
      const list = client.getQueryData<Project[]>(key);
      client.setQueryData(
        key,
        list?.filter(({ id }) => id !== projectId),
      );
      client.removeQueries({ queryKey: projectKey(accountId, projectId) });
      void client.invalidateQueries({ queryKey: ['my-projects'] });
      onDelete();
      void client.invalidateQueries({ queryKey: key });
    },
  });
}
