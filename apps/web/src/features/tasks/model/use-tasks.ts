'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  CreateProjectRoutine,
  CreateProjectTask,
  ProjectRoutine,
  TaskTab,
  UpdateProjectRoutine,
} from '@workspace/types';

import { useActiveProject } from '@/entities/project/use-active-project';
import { projectWork } from '@/shared/api';
import { useWorkStream } from '@/shared/api/use-work-stream';

export function useTasksBoard(tab: 'active' | 'routines' | 'done', agentId?: string, taskId?: string) {
  const { account, project, projectRef, isLoading: projectLoading, canTech } = useActiveProject();
  const client = useQueryClient();

  useWorkStream(account?.id ?? '', project?.id ?? '');

  const enabled = Boolean(projectRef);
  const api = projectRef ? projectWork(projectRef.accountId, projectRef.id) : null;

  const listTab: TaskTab = tab === 'done' ? 'done' : 'active';

  const tasksQuery = useQuery({
    queryKey: ['project-tasks', projectRef?.accountId, projectRef?.id, listTab, agentId ?? 'all'],
    enabled: enabled && tab !== 'routines',
    queryFn: ({ signal }) => api!.tasks(listTab, agentId, signal),
    refetchInterval: (query) =>
      query.state.data?.some((t) => t.status === 'running' || t.status === 'planned') ? 5000 : false,
  });

  const routinesQuery = useQuery({
    queryKey: ['project-routines', projectRef?.accountId, projectRef?.id, agentId ?? 'all'],
    enabled: enabled && tab === 'routines',
    queryFn: ({ signal }) => api!.routines(agentId, signal),
  });

  const countsQuery = useQuery({
    queryKey: ['project-task-counts', projectRef?.accountId, projectRef?.id],
    enabled,
    queryFn: ({ signal }) => api!.taskCounts(signal),
  });

  const taskQuery = useQuery({
    queryKey: ['project-task', projectRef?.accountId, projectRef?.id, taskId ?? ''],
    enabled: enabled && Boolean(taskId),
    queryFn: ({ signal }) => api!.task(taskId!, signal),
    refetchInterval: (query) =>
      query.state.data && (query.state.data.status === 'running' || query.state.data.status === 'planned')
        ? 4000
        : false,
  });

  const invalidateTasks = () => {
    if (!projectRef) return;
    void client.invalidateQueries({ queryKey: ['project-tasks', projectRef.accountId, projectRef.id] });
    void client.invalidateQueries({ queryKey: ['project-task-counts', projectRef.accountId, projectRef.id] });
    if (taskId) {
      void client.invalidateQueries({
        queryKey: ['project-task', projectRef.accountId, projectRef.id, taskId],
      });
    }
  };

  const invalidateRoutines = () => {
    if (!projectRef) return;
    void client.invalidateQueries({ queryKey: ['project-routines', projectRef.accountId, projectRef.id] });
    void client.invalidateQueries({ queryKey: ['project-task-counts', projectRef.accountId, projectRef.id] });
  };

  const createTask = useMutation({
    mutationFn: (input: CreateProjectTask) => api!.createTask(input),
    onSuccess: invalidateTasks,
  });

  const runTask = useMutation({
    mutationFn: (id: string) => api!.runTask(id),
    onSuccess: invalidateTasks,
  });

  const cancelTask = useMutation({
    mutationFn: (id: string) => api!.cancelTask(id),
    onSuccess: invalidateTasks,
  });

  const createRoutine = useMutation({
    mutationFn: (input: CreateProjectRoutine) => api!.createRoutine(input),
    onSuccess: invalidateRoutines,
  });

  const updateRoutine = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProjectRoutine }) => api!.updateRoutine(id, input),
    onMutate: async ({ id, input }) => {
      if (!projectRef) return;
      const key = ['project-routines', projectRef.accountId, projectRef.id, agentId ?? 'all'];
      await client.cancelQueries({ queryKey: key });
      const prev = client.getQueryData<ProjectRoutine[]>(key);
      if (prev) {
        client.setQueryData<ProjectRoutine[]>(
          key,
          prev.map((r) => (r.id === id ? { ...r, ...input } : r)),
        );
      }
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) client.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: invalidateRoutines,
  });

  const runRoutine = useMutation({
    mutationFn: (id: string) => api!.runRoutine(id),
    onSuccess: () => {
      invalidateTasks();
      invalidateRoutines();
    },
  });

  return {
    project,
    projectRef,
    projectLoading,
    canTech,
    tasksQuery,
    routinesQuery,
    countsQuery,
    taskQuery,
    createTask,
    runTask,
    cancelTask,
    createRoutine,
    updateRoutine,
    runRoutine,
  };
}
