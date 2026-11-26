'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { CreateWorkTask, TaskAction, TaskTab, UpdateWorkTask, WorkTask } from '@workspace/types';

import { useMe } from '@/entities/session';
import { tasksApi } from '@/shared/api';

function isGenerating(task: WorkTask) {
  return Boolean(task.agentId && ['planned', 'running'].includes(task.status));
}

export function useTasks(tab: TaskTab, agentId?: string, taskId?: string) {
  const { data: me } = useMe();
  const key = ['tasks', me?.tenantId, me?.id] as const;
  const enabled = Boolean(me);
  const client = useQueryClient();
  const list = useInfiniteQuery({
    queryKey: [...key, 'list', tab, agentId],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => tasksApi.list({ tab, agentId, before: pageParam }, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 0,
    refetchInterval: ({ state }) =>
      state.data?.pages.some((page) => page.tasks.some(isGenerating)) ? 1200 : false,
  });
  const counts = useQuery({
    queryKey: [...key, 'counts', agentId],
    queryFn: ({ signal }) => tasksApi.counts(agentId, signal),
    enabled,
    staleTime: 0,
    refetchInterval: 4000,
  });
  const agents = useQuery({
    queryKey: [...key, 'agents'],
    queryFn: ({ signal }) => tasksApi.agents(signal),
    enabled,
    staleTime: 0,
  });
  const detail = useQuery({
    queryKey: [...key, 'detail', taskId],
    queryFn: ({ signal }) => tasksApi.get(taskId ?? '', signal),
    enabled: enabled && Boolean(taskId),
    staleTime: 0,
    refetchInterval: ({ state }) => (state.data && isGenerating(state.data) ? 1200 : false),
  });
  function refresh(task: WorkTask) {
    client.setQueryData([...key, 'detail', task.id], task);
    void client.invalidateQueries({ queryKey: key });
  }
  const create = useMutation({ mutationFn: tasksApi.create, onSuccess: refresh });
  const update = useMutation({
    mutationFn: ({ id, values }: { id: string; values: UpdateWorkTask }) => tasksApi.update(id, values),
    onSuccess: refresh,
  });
  const action = useMutation({
    mutationFn: ({ id, action }: { id: string; action: TaskAction }) => tasksApi.action(id, action),
    onSuccess: refresh,
  });
  const tasks = [
    ...new Map(list.data?.pages.flatMap((page) => page.tasks.map((task) => [task.id, task]))).values(),
  ];
  return {
    list,
    counts,
    agents,
    detail,
    tasks,
    create,
    update,
    action,
    save: (values: CreateWorkTask, id?: string) => {
      if (!id) return create.mutateAsync(values);
      return update.mutateAsync({
        id,
        values: { title: values.title, description: values.description, dueOn: values.dueOn },
      });
    },
  };
}
