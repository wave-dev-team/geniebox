import type { Insertable, Selectable, Transaction, Updateable } from 'kysely';
import { sql } from 'kysely';

import { Injectable } from '@nestjs/common';

import type {
  DB,
  Json,
  KnowledgeCitations,
  KnowledgeNodes,
  KnowledgeProposals,
  KnowledgeRevisions,
  KnowledgeSources,
} from '../../../database/types.js';
import type {
  KnowledgeNodeKind,
  KnowledgeProposalKind,
  KnowledgeProposalStatus,
  KnowledgeSourceKind,
  KnowledgeSourceStatus,
  KnowledgeStatus,
} from '../knowledge.constants.js';

export type NodeRow = Selectable<KnowledgeNodes> & {
  kind: KnowledgeNodeKind;
  status: KnowledgeStatus;
};
export type SourceRow = Selectable<KnowledgeSources> & {
  kind: KnowledgeSourceKind;
  status: KnowledgeSourceStatus;
};
export type RevisionRow = Selectable<KnowledgeRevisions>;
export type ProposalRow = Selectable<KnowledgeProposals> & {
  kind: KnowledgeProposalKind;
  status: KnowledgeProposalStatus;
};

export interface NodeInsert {
  account_id: string;
  project_id: string;
  parent_id: string | null;
  kind: KnowledgeNodeKind;
  title: string;
  body: string;
  status: KnowledgeStatus;
  position: number;
  content_hash: string | null;
  source_id: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface NodeUpdate {
  parent_id?: string | null;
  title?: string;
  body?: string;
  status?: KnowledgeStatus;
  position?: number;
  content_hash?: string | null;
  indexed_hash?: string | null;
  published_at?: Date | null;
  published_by?: string | null;
  updated_by?: string | null;
  updated_at?: Date;
}

export interface SourceInsert {
  account_id: string;
  project_id: string;
  kind: KnowledgeSourceKind;
  title: string;
  mime: string | null;
  size_bytes: number;
  sha256: string;
  blob_key: string;
  status: KnowledgeSourceStatus;
  period_start: string | null;
  period_end: string | null;
  metadata: Json;
  created_by: string | null;
}

export interface ChunkInsert {
  account_id: string;
  project_id: string;
  node_id: string;
  position: number;
  heading_path: string[];
  text: string;
  token_count: number;
  content_hash: string;
  embedding: string | null;
  embedding_model: string | null;
}

/** A chunk with its page, as search returns it. */
export interface SearchChunk {
  nodeId: string;
  title: string;
  chunkId: string;
  text: string;
  headingPath: string[];
  rank: number;
}

export interface CitationRow {
  node_id: string;
  source_id: string;
  locator: unknown;
  quote: string | null;
}

/** DATE columns come back as `YYYY-MM-DD` strings but are typed as dates by codegen. */
const day = (value: unknown): string | null => (value ? String(value).slice(0, 10) : null);

@Injectable()
export class KnowledgeRepository {
  // ---------------------------------------------------------------- tree

  async listNodes(
    db: Transaction<DB>,
    projectId: string,
    filter: { parentId?: string | null; statuses: KnowledgeStatus[]; updatedAfter?: Date },
  ): Promise<NodeRow[]> {
    let query = db
      .selectFrom('knowledge_nodes')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('status', 'in', filter.statuses);
    if (filter.parentId !== undefined) {
      query =
        filter.parentId === null
          ? query.where('parent_id', 'is', null)
          : query.where('parent_id', '=', filter.parentId);
    }
    if (filter.updatedAfter) query = query.where('updated_at', '>', filter.updatedAfter);
    const rows = await query.orderBy('position').orderBy('title').execute();
    return rows as NodeRow[];
  }

  async findNode(db: Transaction<DB>, projectId: string, id: string): Promise<NodeRow | undefined> {
    const row = await db
      .selectFrom('knowledge_nodes')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row as NodeRow | undefined;
  }

  /** Ids of the node and its whole subtree, for filtering search by folder. */
  async subtreeIds(db: Transaction<DB>, projectId: string, rootId: string): Promise<string[]> {
    const result = await sql<{ id: string }>`
      WITH RECURSIVE tree AS (
        SELECT id FROM knowledge_nodes WHERE project_id = ${projectId} AND id = ${rootId}
        UNION ALL
        SELECT child.id FROM knowledge_nodes child
          JOIN tree ON child.parent_id = tree.id
          WHERE child.project_id = ${projectId}
      )
      SELECT id FROM tree
    `.execute(db);
    return result.rows.map((row) => row.id);
  }

  async insertNode(db: Transaction<DB>, values: NodeInsert): Promise<NodeRow> {
    const row = await db
      .insertInto('knowledge_nodes')
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
    return row as NodeRow;
  }

  async updateNode(
    db: Transaction<DB>,
    projectId: string,
    id: string,
    values: NodeUpdate,
  ): Promise<NodeRow | undefined> {
    if (Object.keys(values).length === 0) return this.findNode(db, projectId, id);
    const row = await db
      .updateTable('knowledge_nodes')
      .set(values)
      .where('project_id', '=', projectId)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row as NodeRow | undefined;
  }

  async nextPosition(db: Transaction<DB>, projectId: string, parentId: string | null): Promise<number> {
    let query = db
      .selectFrom('knowledge_nodes')
      .select(sql<number>`coalesce(max(position) + 1, 0)`.as('next'))
      .where('project_id', '=', projectId);
    query =
      parentId === null ? query.where('parent_id', 'is', null) : query.where('parent_id', '=', parentId);
    const row = await query.executeTakeFirst();
    return Number(row?.next ?? 0);
  }

  async publishedNodes(db: Transaction<DB>, projectId: string): Promise<NodeRow[]> {
    const rows = await db
      .selectFrom('knowledge_nodes')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('status', '=', 'published')
      .orderBy('position')
      .orderBy('title')
      .execute();
    return rows as NodeRow[];
  }

  // ---------------------------------------------------------------- sources

  async findSourceByHash(
    db: Transaction<DB>,
    projectId: string,
    sha256: string,
  ): Promise<SourceRow | undefined> {
    const row = await db
      .selectFrom('knowledge_sources')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('sha256', '=', sha256)
      .executeTakeFirst();
    return row as SourceRow | undefined;
  }

  async findSource(db: Transaction<DB>, projectId: string, id: string): Promise<SourceRow | undefined> {
    const row = await db
      .selectFrom('knowledge_sources')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row as SourceRow | undefined;
  }

  async listSources(
    db: Transaction<DB>,
    projectId: string,
    status: KnowledgeSourceStatus | undefined,
    limit: number,
  ): Promise<SourceRow[]> {
    let query = db.selectFrom('knowledge_sources').selectAll().where('project_id', '=', projectId);
    if (status) query = query.where('status', '=', status);
    const rows = await query.orderBy('created_at', 'desc').limit(limit).execute();
    return rows as SourceRow[];
  }

  async insertSource(db: Transaction<DB>, values: SourceInsert): Promise<SourceRow> {
    const row = await db
      .insertInto('knowledge_sources')
      .values(values as Insertable<KnowledgeSources>)
      .returningAll()
      .executeTakeFirstOrThrow();
    return row as SourceRow;
  }

  async updateSource(
    db: Transaction<DB>,
    projectId: string,
    id: string,
    values: Updateable<KnowledgeSources>,
  ): Promise<SourceRow | undefined> {
    const row = await db
      .updateTable('knowledge_sources')
      .set({ ...values, updated_at: new Date() })
      .where('project_id', '=', projectId)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row as SourceRow | undefined;
  }

  /** Sources waiting for the worker after a restart; also drives the retry sweep. */
  async staleSources(db: Transaction<DB>, olderThan: Date, limit: number): Promise<SourceRow[]> {
    const rows = await db
      .selectFrom('knowledge_sources')
      .selectAll()
      .where('status', '=', 'processing')
      .where('updated_at', '<', olderThan)
      .orderBy('updated_at')
      .limit(limit)
      .execute();
    return rows as SourceRow[];
  }

  // ---------------------------------------------------------------- revisions

  async listRevisions(db: Transaction<DB>, nodeId: string, limit: number): Promise<RevisionRow[]> {
    return db
      .selectFrom('knowledge_revisions')
      .selectAll()
      .where('node_id', '=', nodeId)
      .orderBy('revision', 'desc')
      .limit(limit)
      .execute();
  }

  async findRevision(
    db: Transaction<DB>,
    nodeId: string,
    revision: number,
  ): Promise<RevisionRow | undefined> {
    return db
      .selectFrom('knowledge_revisions')
      .selectAll()
      .where('node_id', '=', nodeId)
      .where('revision', '=', revision)
      .executeTakeFirst();
  }

  /** Appends the next revision of a node; one row per content change. */
  async appendRevision(
    db: Transaction<DB>,
    values: Omit<Insertable<KnowledgeRevisions>, 'revision'>,
  ): Promise<void> {
    await sql`
      INSERT INTO knowledge_revisions (account_id, node_id, revision, title, body, status, author_id, author_kind)
      SELECT ${values.account_id}, ${values.node_id},
             coalesce(max(revision), 0) + 1,
             ${values.title}, ${values.body}, ${values.status},
             ${values.author_id ?? null}, ${values.author_kind ?? 'user'}
        FROM knowledge_revisions WHERE node_id = ${values.node_id}
    `.execute(db);
  }

  // ---------------------------------------------------------------- citations

  async replaceCitations(
    db: Transaction<DB>,
    nodeId: string,
    values: Array<Omit<Insertable<KnowledgeCitations>, 'node_id'>>,
  ): Promise<void> {
    await db.deleteFrom('knowledge_citations').where('node_id', '=', nodeId).execute();
    if (!values.length) return;
    await db
      .insertInto('knowledge_citations')
      .values(values.map((value) => ({ ...value, node_id: nodeId })))
      .execute();
  }

  async citationsFor(db: Transaction<DB>, nodeIds: string[]): Promise<CitationRow[]> {
    if (!nodeIds.length) return [];
    return db
      .selectFrom('knowledge_citations')
      .select(['node_id', 'source_id', 'locator', 'quote'])
      .where('node_id', 'in', nodeIds)
      .execute();
  }

  async findSources(db: Transaction<DB>, ids: string[]): Promise<SourceRow[]> {
    if (!ids.length) return [];
    const rows = await db.selectFrom('knowledge_sources').selectAll().where('id', 'in', ids).execute();
    return rows as SourceRow[];
  }

  // ---------------------------------------------------------------- chunks and search

  async replaceChunks(db: Transaction<DB>, nodeId: string, values: ChunkInsert[]): Promise<void> {
    await db.deleteFrom('knowledge_chunks').where('node_id', '=', nodeId).execute();
    if (!values.length) return;
    await db.insertInto('knowledge_chunks').values(values).execute();
  }

  async deleteChunks(db: Transaction<DB>, nodeId: string): Promise<void> {
    await db.deleteFrom('knowledge_chunks').where('node_id', '=', nodeId).execute();
  }

  async chunkCount(db: Transaction<DB>, projectId: string): Promise<number> {
    const row = await db
      .selectFrom('knowledge_chunks')
      .select(sql<number>`count(*)`.as('count'))
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  /** Full-text candidates over published pages, optionally limited to a subtree. */
  async searchFullText(
    db: Transaction<DB>,
    projectId: string,
    query: string,
    nodeIds: string[] | null,
    limit: number,
  ): Promise<SearchChunk[]> {
    const subtree = nodeIds ? sql`AND c.node_id = ANY(${nodeIds}::uuid[])` : sql``;
    const result = await sql<{
      node_id: string;
      title: string;
      chunk_id: string;
      text: string;
      heading_path: string[];
      rank: number;
    }>`
      SELECT c.node_id, n.title, c.id AS chunk_id, c.text, c.heading_path,
             ts_rank_cd(c.tsv, q.query) AS rank
        FROM knowledge_chunks c
        JOIN knowledge_nodes n ON n.account_id = c.account_id AND n.id = c.node_id
        CROSS JOIN LATERAL (SELECT websearch_to_tsquery('russian', ${query}) AS query) q
       WHERE c.project_id = ${projectId}
         AND n.status = 'published'
         AND c.tsv @@ q.query
         ${subtree}
       ORDER BY rank DESC, c.position
       LIMIT ${limit}
    `.execute(db);
    return result.rows.map((row) => ({
      nodeId: row.node_id,
      title: row.title,
      chunkId: row.chunk_id,
      text: row.text,
      headingPath: row.heading_path,
      rank: Number(row.rank),
    }));
  }

  /** Vector candidates; null when no embedding provider is configured. */
  async searchVector(
    db: Transaction<DB>,
    projectId: string,
    vector: number[],
    nodeIds: string[] | null,
    limit: number,
  ): Promise<SearchChunk[]> {
    const literal = `[${vector.map((value) => value.toFixed(6)).join(',')}]`;
    const subtree = nodeIds ? sql`AND c.node_id = ANY(${nodeIds}::uuid[])` : sql``;
    const result = await sql<{
      node_id: string;
      title: string;
      chunk_id: string;
      text: string;
      heading_path: string[];
      rank: number;
    }>`
      SELECT c.node_id, n.title, c.id AS chunk_id, c.text, c.heading_path,
             1 - (c.embedding <=> ${literal}::vector) AS rank
        FROM knowledge_chunks c
        JOIN knowledge_nodes n ON n.account_id = c.account_id AND n.id = c.node_id
       WHERE c.project_id = ${projectId}
         AND n.status = 'published'
         AND c.embedding IS NOT NULL
         ${subtree}
       ORDER BY c.embedding <=> ${literal}::vector
       LIMIT ${limit}
    `.execute(db);
    return result.rows.map((row) => ({
      nodeId: row.node_id,
      title: row.title,
      chunkId: row.chunk_id,
      text: row.text,
      headingPath: row.heading_path,
      rank: Number(row.rank),
    }));
  }

  /** Exact-ish title matches: names, contractual terms, article numbers. */
  async searchTitles(
    db: Transaction<DB>,
    projectId: string,
    query: string,
    nodeIds: string[] | null,
    limit: number,
  ): Promise<Array<{ nodeId: string; title: string; score: number }>> {
    const like = `%${query.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
    const subtree = nodeIds ? sql`AND n.id = ANY(${nodeIds}::uuid[])` : sql``;
    const result = await sql<{ id: string; title: string; score: number }>`
      SELECT n.id, n.title, similarity(n.title, ${query}) AS score
        FROM knowledge_nodes n
       WHERE n.project_id = ${projectId}
         AND n.status = 'published'
         AND n.kind = 'page'
         AND (n.title ILIKE ${like} OR n.title % ${query})
         ${subtree}
       ORDER BY score DESC
       LIMIT ${limit}
    `.execute(db);
    return result.rows.map((row) => ({ nodeId: row.id, title: row.title, score: Number(row.score) }));
  }

  // ---------------------------------------------------------------- proposals

  async insertProposal(
    db: Transaction<DB>,
    values: {
      account_id: string;
      project_id: string;
      agent_id: string;
      kind: KnowledgeProposalKind;
      payload: Record<string, unknown>;
    },
  ): Promise<ProposalRow> {
    const row = await db
      .insertInto('knowledge_proposals')
      .values({ ...values, payload: JSON.stringify(values.payload) })
      .returningAll()
      .executeTakeFirstOrThrow();
    return row as ProposalRow;
  }

  async listProposals(
    db: Transaction<DB>,
    projectId: string,
    status: KnowledgeProposalStatus | undefined,
    limit: number,
  ): Promise<ProposalRow[]> {
    let query = db.selectFrom('knowledge_proposals').selectAll().where('project_id', '=', projectId);
    if (status) query = query.where('status', '=', status);
    const rows = await query.orderBy('created_at', 'desc').limit(limit).execute();
    return rows as ProposalRow[];
  }

  async findProposal(db: Transaction<DB>, projectId: string, id: string): Promise<ProposalRow | undefined> {
    const row = await db
      .selectFrom('knowledge_proposals')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row as ProposalRow | undefined;
  }

  async resolveProposal(
    db: Transaction<DB>,
    projectId: string,
    id: string,
    status: 'accepted' | 'rejected',
    userId: string,
  ): Promise<ProposalRow | undefined> {
    const row = await db
      .updateTable('knowledge_proposals')
      .set({ status, resolved_by: userId, resolved_at: new Date() })
      .where('project_id', '=', projectId)
      .where('id', '=', id)
      .where('status', '=', 'open')
      .returningAll()
      .executeTakeFirst();
    return row as ProposalRow | undefined;
  }

  /** Pages a person has to look at yet: drafts, failed sources, open proposals. */
  async counts(
    db: Transaction<DB>,
    projectId: string,
  ): Promise<{ drafts: number; published: number; failedSources: number; openProposals: number }> {
    const [nodes, sources, proposals] = await Promise.all([
      db
        .selectFrom('knowledge_nodes')
        .select(['status', sql<number>`count(*)`.as('count')])
        .where('project_id', '=', projectId)
        .groupBy('status')
        .execute(),
      db
        .selectFrom('knowledge_sources')
        .select(sql<number>`count(*)`.as('count'))
        .where('project_id', '=', projectId)
        .where('status', '=', 'failed')
        .executeTakeFirst(),
      db
        .selectFrom('knowledge_proposals')
        .select(sql<number>`count(*)`.as('count'))
        .where('project_id', '=', projectId)
        .where('status', '=', 'open')
        .executeTakeFirst(),
    ]);
    const byStatus = new Map(nodes.map((row) => [row.status, Number(row.count)]));
    return {
      drafts: byStatus.get('draft') ?? 0,
      published: byStatus.get('published') ?? 0,
      failedSources: Number(sources?.count ?? 0),
      openProposals: Number(proposals?.count ?? 0),
    };
  }
}

export { day };
