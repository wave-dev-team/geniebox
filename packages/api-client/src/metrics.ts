import {
  type MetricKey,
  type MetricsReportInput,
  metricsReportSchema,
  metricsReportsSchema,
  metricsSchema,
} from '@workspace/types';

import { authenticated } from './authenticated.js';

export const metricsApi = {
  list: async (signal?: AbortSignal) =>
    metricsSchema.parse(await (await authenticated('/v1/metrics', { signal })).json()),
  rename: (key: MetricKey, label: string) =>
    authenticated('/v1/metrics', { method: 'PUT', body: JSON.stringify({ key, label }) }),
};

export const reportsApi = {
  list: async (before?: string, signal?: AbortSignal) => {
    const path = before ? `/v1/reports?before=${encodeURIComponent(before)}` : '/v1/reports';
    return metricsReportsSchema.parse(await (await authenticated(path, { signal })).json());
  },
  create: async (body: MetricsReportInput) =>
    metricsReportSchema.parse(
      await (
        await authenticated('/v1/reports', {
          method: 'POST',
          body: JSON.stringify(body),
        })
      ).json(),
    ),
};
