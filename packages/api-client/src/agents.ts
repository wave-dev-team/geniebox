import { z } from 'zod';

import { agentSchema, agentVersionSchema, type UpdateAgent } from '@workspace/types';

import { authenticated } from './authenticated.js';

const historySchema = z.object({
  items: agentVersionSchema.array(),
  next: z.number().int().positive().nullable(),
});

const path = '/v1/agents';
const url = (id: string) => `${path}/${encodeURIComponent(id)}`;

export const agentsApi = {
  list: async (signal?: AbortSignal) =>
    agentSchema.array().parse(await (await authenticated(path, { signal })).json()),
  update: async (id: string, input: UpdateAgent) =>
    agentSchema.parse(
      await (await authenticated(url(id), { method: 'PATCH', body: JSON.stringify(input) })).json(),
    ),
  history: async (id: string, before?: number, signal?: AbortSignal) =>
    historySchema.parse(
      await (
        await authenticated(`${url(id)}/versions${before ? `?before=${before}` : ''}`, { signal })
      ).json(),
    ),
  restore: async (id: string, revision: number, expectedRevision: number) =>
    agentSchema.parse(
      await (
        await authenticated(`${url(id)}/restore`, {
          method: 'POST',
          body: JSON.stringify({ revision, expectedRevision }),
        })
      ).json(),
    ),
};
