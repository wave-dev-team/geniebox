import {
  type CreateProjectRoutine,
  type CreateProjectTask,
  routineSchema,
  taskCountsSchema,
  taskResponseSchema,
  type TaskTab,
  type UpdateProjectRoutine,
} from '@workspace/types';

import { projectPath } from './accounts.js';
import { authenticated } from './authenticated.js';

export function projectWork(accountId: string, projectId: string) {
  const path = projectPath(accountId, projectId);
  const taskPath = (id: string) => `${path}/tasks/${encodeURIComponent(id)}`;
  const routinePath = (id: string) => `${path}/routines/${encodeURIComponent(id)}`;
  return {
    tasks: async (tab: TaskTab, agentId?: string, signal?: AbortSignal) => {
      const query = new URLSearchParams({ tab });
      if (agentId) query.set('agentId', agentId);
      return taskResponseSchema
        .array()
        .parse(await (await authenticated(`${path}/tasks?${query.toString()}`, { signal })).json());
    },
    taskCounts: async (signal?: AbortSignal) =>
      taskCountsSchema.parse(await (await authenticated(`${path}/task-counts`, { signal })).json()),
    task: async (id: string, signal?: AbortSignal) =>
      taskResponseSchema.parse(await (await authenticated(taskPath(id), { signal })).json()),
    createTask: async (input: CreateProjectTask) =>
      taskResponseSchema.parse(
        await (await authenticated(`${path}/tasks`, { method: 'POST', body: JSON.stringify(input) })).json(),
      ),
    runTask: async (id: string) =>
      taskResponseSchema.parse(await (await authenticated(`${taskPath(id)}/run`, { method: 'POST' })).json()),
    cancelTask: async (id: string) =>
      taskResponseSchema.parse(
        await (await authenticated(`${taskPath(id)}/cancel`, { method: 'POST' })).json(),
      ),
    routines: async (agentId?: string, signal?: AbortSignal) => {
      const query = new URLSearchParams();
      if (agentId) query.set('agentId', agentId);
      const qs = query.toString();
      return routineSchema
        .array()
        .parse(await (await authenticated(`${path}/routines${qs ? `?${qs}` : ''}`, { signal })).json());
    },
    routine: async (id: string, signal?: AbortSignal) =>
      routineSchema.parse(await (await authenticated(routinePath(id), { signal })).json()),
    createRoutine: async (input: CreateProjectRoutine) =>
      routineSchema.parse(
        await (
          await authenticated(`${path}/routines`, { method: 'POST', body: JSON.stringify(input) })
        ).json(),
      ),
    updateRoutine: async (id: string, input: UpdateProjectRoutine) =>
      routineSchema.parse(
        await (await authenticated(routinePath(id), { method: 'PATCH', body: JSON.stringify(input) })).json(),
      ),
    runRoutine: async (id: string) =>
      taskResponseSchema.parse(
        await (await authenticated(`${routinePath(id)}/run`, { method: 'POST' })).json(),
      ),
  };
}
