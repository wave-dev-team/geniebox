import { z } from 'zod';

import {
  type CreateWorkTask,
  type TaskAction,
  taskCountsSchema,
  taskPageSchema,
  type TaskTab,
  type UpdateWorkTask,
  workTaskSchema,
} from '@workspace/types';

import { authenticated } from './authenticated.js';

const agentsSchema = z.array(z.object({ id: z.uuid(), name: z.string(), enabled: z.boolean() }));
const path = (id: string) => `/v1/tasks/${encodeURIComponent(id)}`;

function filterQuery(values: { tab?: TaskTab; agentId?: string; before?: string }) {
  const params = new URLSearchParams();
  if (values.tab) params.set('tab', values.tab);
  if (values.agentId) params.set('agentId', values.agentId);
  if (values.before) params.set('before', values.before);
  return params.size ? `?${params.toString()}` : '';
}

export const tasksApi = {
  agents: async (signal?: AbortSignal) =>
    agentsSchema.parse(await (await authenticated('/v1/agents', { signal })).json()),
  list: async (filters: { tab: TaskTab; agentId?: string; before?: string }, signal?: AbortSignal) =>
    taskPageSchema.parse(await (await authenticated(`/v1/tasks${filterQuery(filters)}`, { signal })).json()),
  counts: async (agentId?: string, signal?: AbortSignal) =>
    taskCountsSchema.parse(
      await (await authenticated(`/v1/tasks/counts${filterQuery({ agentId })}`, { signal })).json(),
    ),
  get: async (id: string, signal?: AbortSignal) =>
    workTaskSchema.parse(await (await authenticated(path(id), { signal })).json()),
  create: async (input: CreateWorkTask) =>
    workTaskSchema.parse(
      await (await authenticated('/v1/tasks', { method: 'POST', body: JSON.stringify(input) })).json(),
    ),
  update: async (id: string, input: UpdateWorkTask) =>
    workTaskSchema.parse(
      await (await authenticated(path(id), { method: 'PATCH', body: JSON.stringify(input) })).json(),
    ),
  action: async (id: string, action: TaskAction) =>
    workTaskSchema.parse(
      await (
        await authenticated(`${path(id)}/actions`, { method: 'POST', body: JSON.stringify({ action }) })
      ).json(),
    ),
};
