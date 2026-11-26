import { connectionsSchema, type MetricaConnectionInput } from '@workspace/types';

import { authenticated } from './authenticated.js';

const path = '/v1/connections';

export const connectionsApi = {
  list: async (signal?: AbortSignal) =>
    connectionsSchema.parse(await (await authenticated(path, { signal })).json()),
  save: (input: MetricaConnectionInput) =>
    authenticated(`${path}/yandex-metrica`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  remove: () => authenticated(`${path}/yandex-metrica`, { method: 'DELETE' }),
};
