import { z } from 'zod';

import { type CreateRoutine, routineSchema, routinesSchema } from '@workspace/types';

import { authenticated } from './authenticated.js';

const path = '/v1/routines';
const url = (id: string) => `${path}/${encodeURIComponent(id)}`;

export const routinesApi = {
  list: async (signal?: AbortSignal) =>
    routinesSchema.parse(await (await authenticated(path, { signal })).json()),
  create: async (input: CreateRoutine) =>
    routineSchema.parse(
      await (await authenticated(path, { method: 'POST', body: JSON.stringify(input) })).json(),
    ),
  enable: (id: string, enabled: boolean) =>
    authenticated(url(id), { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  run: async (id: string, requestId: string) =>
    z.object({ taskId: z.uuid() }).parse(
      await (
        await authenticated(`${url(id)}/run`, {
          method: 'POST',
          body: JSON.stringify({ id: requestId }),
        })
      ).json(),
    ),
};
