import { z } from 'zod';

import {
  agentActionPageSchema,
  type AgentActionType,
  agentStatsSchema,
  connectionProviderSchema,
  importJobResponseSchema,
  importJobSchema,
  importResponseSchema,
  type ImportResult,
  type ImportSkeleton,
  type JournalFilters,
  onboardingAgentCatalogSchema,
  type PermissionMode,
  projectAgentDetailsSchema,
  projectAgentSchema,
  projectConnectionSchema,
  projectJournalSchema,
} from '@workspace/types';

import { projectPath } from './accounts.js';
import { authenticated } from './authenticated.js';

export function projectOperations(accountId: string, projectId: string) {
  const path = projectPath(accountId, projectId);
  const agentPath = (id: string) => path + '/agents/' + encodeURIComponent(id);
  const journalQuery = (filters: JournalFilters, cursor?: string) => {
    const query = new URLSearchParams({ period: filters.period });
    if (filters.agentId) query.set('agentId', filters.agentId);
    if (filters.connectionId) query.set('connectionId', filters.connectionId);
    if (filters.result) query.set('result', filters.result);
    if (cursor) query.set('cursor', cursor);
    return query.toString();
  };
  return {
    agents: async (signal?: AbortSignal) =>
      projectAgentSchema.array().parse(await (await authenticated(path + '/agents', { signal })).json()),
    agent: async (id: string, signal?: AbortSignal) =>
      projectAgentDetailsSchema.parse(await (await authenticated(agentPath(id), { signal })).json()),
    pauseAgent: async (id: string, until?: string) =>
      projectAgentDetailsSchema.parse(
        await (
          await authenticated(agentPath(id) + '/pause', {
            method: 'POST',
            body: JSON.stringify(until ? { until } : {}),
          })
        ).json(),
      ),
    resumeAgent: async (id: string) =>
      projectAgentDetailsSchema.parse(
        await (await authenticated(agentPath(id) + '/resume', { method: 'POST' })).json(),
      ),
    agentStats: async (id: string, signal?: AbortSignal) =>
      agentStatsSchema.parse(await (await authenticated(agentPath(id) + '/stats', { signal })).json()),
    agentActions: async (
      id: string,
      filters: { period?: '7d' | '30d'; types?: AgentActionType[]; cursor?: string } = {},
      signal?: AbortSignal,
    ) => {
      const query = new URLSearchParams();
      if (filters.period) query.set('period', filters.period);
      if (filters.types?.length) query.set('types', filters.types.join(','));
      if (filters.cursor) query.set('cursor', filters.cursor);
      const qs = query.toString();
      return agentActionPageSchema.parse(
        await (await authenticated(agentPath(id) + '/actions' + (qs ? `?${qs}` : ''), { signal })).json(),
      );
    },
    setPermission: async (id: string, actionId: string, mode: PermissionMode | null) =>
      projectAgentDetailsSchema.parse(
        await (
          await authenticated(agentPath(id) + '/permissions', {
            method: 'PUT',
            body: JSON.stringify({ items: [{ actionId, mode }] }),
          })
        ).json(),
      ),
    connections: async (signal?: AbortSignal) =>
      projectConnectionSchema
        .array()
        .parse(await (await authenticated(path + '/connections', { signal })).json()),
    connect: async (
      providerKey: string,
      accessLevel: 'read' | 'read_write',
      fields: Record<string, string>,
    ) => {
      const response = await authenticated(path + '/connections', {
        method: 'POST',
        body: JSON.stringify({ providerKey, accessLevel, fields }),
      });
      return z.object({ connection: projectConnectionSchema }).parse(await response.json());
    },
    analyzeImport: async (skeleton: ImportSkeleton) =>
      importJobResponseSchema.parse(
        await (
          await authenticated(path + '/connections/import/analyze', {
            method: 'POST',
            body: JSON.stringify({ skeleton }),
          })
        ).json(),
      ),
    clarifyImport: async (input: {
      skeleton: ImportSkeleton;
      answer: string;
      question?: string;
      previous?: ImportResult;
    }) =>
      importJobResponseSchema.parse(
        await (
          await authenticated(path + '/connections/import/clarify', {
            method: 'POST',
            body: JSON.stringify(input),
          })
        ).json(),
      ),
    importStatus: async (jobId: string) =>
      importJobSchema.parse(
        await (await authenticated(path + '/connections/import/analyze/' + encodeURIComponent(jobId))).json(),
      ),
    importConnections: async (
      groups: Array<{
        providerKey: string;
        accessLevel: 'read' | 'read_write';
        fields: Record<string, string>;
      }>,
      mode: 'skip' | 'replace' = 'skip',
    ) =>
      importResponseSchema.parse(
        await (
          await authenticated(path + '/connections/import', {
            method: 'POST',
            body: JSON.stringify({ groups, mode }),
          })
        ).json(),
      ),
    disconnectAll: async () => {
      await authenticated(path + '/connections/disconnect-all', { method: 'POST' });
    },
    rotate: async (id: string, fields?: Record<string, string>) => {
      const response = await authenticated(path + '/connections/' + encodeURIComponent(id) + '/rotate', {
        method: 'POST',
        body: JSON.stringify(fields ? { fields } : {}),
      });
      return z
        .object({
          connection: projectConnectionSchema,
          check: z.object({ status: z.enum(['ok', 'warn', 'error']) }).nullable(),
        })
        .parse(await response.json());
    },
    journal: async (filters: JournalFilters, cursor: string | undefined, signal?: AbortSignal) =>
      projectJournalSchema.parse(
        await (await authenticated(path + '/journal?' + journalQuery(filters, cursor), { signal })).json(),
      ),
    journalCsv: async (filters: JournalFilters) =>
      (await authenticated(path + '/journal.csv?' + journalQuery(filters))).blob(),
  };
}

export async function listConnectionProviders(signal?: AbortSignal) {
  return connectionProviderSchema
    .array()
    .parse(await (await authenticated('/v1/connection-providers', { signal })).json());
}

export async function listOnboardingAgents(accountId: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ accountId });
  const response = await authenticated('/v1/agent-catalog?' + query, { signal });
  return onboardingAgentCatalogSchema.parse(await response.json());
}
