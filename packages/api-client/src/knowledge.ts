import { z } from 'zod';

import { authenticated } from './authenticated.js';

const nodeSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  kind: z.enum(['folder', 'page']),
  title: z.string(),
  body: z.string(),
  status: z.enum(['draft', 'published', 'archived']),
  position: z.number(),
  sourceId: z.uuid().nullable(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
});

const sourceSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  kind: z.string(),
  mime: z.string().nullable(),
  sizeBytes: z.number(),
  status: z.enum(['processing', 'ready', 'failed', 'archived']),
  error: z.string().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

const sourceRefSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  limitations: z.array(z.string()),
});

const searchResultSchema = z.object({
  items: z.array(
    z.object({
      nodeId: z.uuid(),
      title: z.string(),
      headingPath: z.array(z.string()),
      snippet: z.string(),
      score: z.number(),
      sourceIds: z.array(z.uuid()),
      sources: z.array(sourceRefSchema),
    }),
  ),
});

const revisionSchema = z.object({
  revision: z.number(),
  title: z.string(),
  body: z.string(),
  status: z.enum(['draft', 'published', 'archived']),
  authorKind: z.string(),
  authorId: z.uuid().nullable(),
  createdAt: z.string(),
});

const proposalSchema = z.object({
  id: z.uuid(),
  agentId: z.uuid(),
  kind: z.enum(['create', 'edit', 'gap']),
  status: z.enum(['open', 'accepted', 'rejected']),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

const statsSchema = z.object({
  drafts: z.number(),
  published: z.number(),
  failedSources: z.number(),
  openProposals: z.number(),
  chunks: z.number(),
  embeddings: z.boolean(),
});

export type KnowledgeNode = z.infer<typeof nodeSchema>;
export type KnowledgeSource = z.infer<typeof sourceSchema>;
export type KnowledgeSearchResult = z.infer<typeof searchResultSchema>;
export type KnowledgeRevision = z.infer<typeof revisionSchema>;
export type KnowledgeProposal = z.infer<typeof proposalSchema>;
export type KnowledgeStats = z.infer<typeof statsSchema>;

export interface KnowledgeSourceInput {
  kind: 'upload' | 'text';
  title?: string;
  filename?: string;
  contentBase64?: string;
  text?: string;
  periodStart?: string;
  periodEnd?: string;
  metadata?: Record<string, unknown>;
}

/** Knowledge base of the active project: the tree, sources, search and agent proposals. */
export function knowledgeApi(accountId: string, projectId: string) {
  const base = `/v1/accounts/${accountId}/projects/${projectId}/knowledge`;
  const node = (id: string) => `${base}/nodes/${id}`;

  return {
    tree: async (signal?: AbortSignal) =>
      z.array(nodeSchema).parse(await (await authenticated(`${base}/nodes`, { signal })).json()),
    node: async (id: string, signal?: AbortSignal) =>
      nodeSchema.parse(await (await authenticated(node(id), { signal })).json()),
    createNode: async (input: {
      kind: 'folder' | 'page';
      title: string;
      body?: string;
      parentId?: string | null;
    }) =>
      nodeSchema.parse(
        await (await authenticated(`${base}/nodes`, { method: 'POST', body: JSON.stringify(input) })).json(),
      ),
    updateNode: async (
      id: string,
      input: { title?: string; body?: string; parentId?: string | null; position?: number },
    ) =>
      nodeSchema.parse(
        await (await authenticated(node(id), { method: 'PATCH', body: JSON.stringify(input) })).json(),
      ),
    publish: async (id: string) =>
      nodeSchema.parse(await (await authenticated(`${node(id)}/publish`, { method: 'POST' })).json()),
    archive: async (id: string) =>
      nodeSchema.parse(await (await authenticated(`${node(id)}/archive`, { method: 'POST' })).json()),
    restore: async (id: string) =>
      nodeSchema.parse(await (await authenticated(`${node(id)}/restore`, { method: 'POST' })).json()),
    revisions: async (id: string, signal?: AbortSignal) =>
      z.array(revisionSchema).parse(await (await authenticated(`${node(id)}/revisions`, { signal })).json()),
    restoreRevision: async (id: string, revision: number) =>
      nodeSchema.parse(
        await (await authenticated(`${node(id)}/revisions/${revision}/restore`, { method: 'POST' })).json(),
      ),
    sources: async (signal?: AbortSignal) =>
      z.array(sourceSchema).parse(await (await authenticated(`${base}/sources`, { signal })).json()),
    createSource: async (input: KnowledgeSourceInput) =>
      sourceSchema.parse(
        await (
          await authenticated(`${base}/sources`, { method: 'POST', body: JSON.stringify(input) })
        ).json(),
      ),
    retrySource: async (id: string) =>
      sourceSchema.parse(
        await (await authenticated(`${base}/sources/${id}/retry`, { method: 'POST' })).json(),
      ),
    search: async (q: string, signal?: AbortSignal) =>
      searchResultSchema.parse(
        await (await authenticated(`${base}/search?q=${encodeURIComponent(q)}`, { signal })).json(),
      ),
    proposals: async (signal?: AbortSignal) =>
      z
        .array(proposalSchema)
        .parse(await (await authenticated(`${base}/proposals?status=open`, { signal })).json()),
    acceptProposal: async (id: string) =>
      proposalSchema.parse(
        await (await authenticated(`${base}/proposals/${id}/accept`, { method: 'POST' })).json(),
      ),
    rejectProposal: async (id: string) =>
      proposalSchema.parse(
        await (await authenticated(`${base}/proposals/${id}/reject`, { method: 'POST' })).json(),
      ),
    stats: async (signal?: AbortSignal) =>
      statsSchema.parse(await (await authenticated(`${base}/stats`, { signal })).json()),
  };
}
