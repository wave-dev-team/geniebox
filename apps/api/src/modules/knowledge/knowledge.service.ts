import { createHash } from 'node:crypto';

import type { Transaction } from 'kysely';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type AccountRole, hasRoleAtLeast } from '../../common/auth/account-role.js';
import type { Env } from '../../config/env.schema.js';
import { AccountDb, type AccountTx } from '../../database/scoped-db.js';
import type { DB, Json } from '../../database/types.js';
import { JournalService } from '../../journal/journal.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { AccountContext } from '../accounts/account-context.js';
import { ProjectContext } from '../projects/project-context.js';
import { StreamPublisher } from '../stream/stream.publisher.js';
import { BlobStore } from './blob-store.js';
import type { SearchQueryDto } from './dto/knowledge.dto.js';
import { EmbeddingsService } from './embeddings.js';
import {
  KNOWLEDGE_EVENTS,
  type KnowledgeNodeEvent,
  type KnowledgeProposalResolvedEvent,
  type KnowledgeSourceEvent,
} from './events/knowledge.events.js';
import { detectFormat, mimeFor, UnsupportedSourceError } from './extract.js';
import {
  KNOWLEDGE_ACTIONS,
  KNOWLEDGE_LIMITS,
  type KnowledgeFileFormat,
  type KnowledgeNodeKind,
  type KnowledgeProposalStatus,
  type KnowledgeSourceStatus,
  type KnowledgeStatus,
} from './knowledge.constants.js';
import { KNOWLEDGE_ERRORS, KnowledgeException } from './knowledge.errors.js';
import type { NodeRow, ProposalRow, SearchChunk, SourceRow } from './repositories/knowledge.repository.js';
import { KnowledgeRepository } from './repositories/knowledge.repository.js';

const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');
const day = (value: unknown): string | null => (value ? String(value).slice(0, 10) : null);
const rrf = (rank: number): number => 1 / (60 + rank + 1);

export interface SearchItem {
  nodeId: string;
  title: string;
  headingPath: string[];
  snippet: string;
  score: number;
  sourceIds: string[];
  sources: Array<{
    id: string;
    title: string;
    periodStart: string | null;
    periodEnd: string | null;
    limitations: string[];
  }>;
}

/**
 * The curated knowledge tree: people create, review and publish; agents only read published
 * pages and propose changes. Every write is journaled and emits an outbox event.
 */
@Injectable()
export class KnowledgeService {
  private readonly maxUploadBytes: number;

  constructor(
    private readonly accountDb: AccountDb,
    private readonly repo: KnowledgeRepository,
    private readonly blobs: BlobStore,
    private readonly embeddings: EmbeddingsService,
    private readonly accountContext: AccountContext,
    private readonly projectContext: ProjectContext,
    private readonly journal: JournalService,
    private readonly outbox: OutboxService,
    private readonly stream: StreamPublisher,
    config: ConfigService<Env, true>,
  ) {
    this.maxUploadBytes = config.get('KNOWLEDGE_MAX_UPLOAD_BYTES', { infer: true });
  }

  // ---------------------------------------------------------------- tree

  /** `viewer` sees published pages only; everybody else also sees drafts and the archive. */
  async tree(filter: { parentId?: string | null; status?: KnowledgeStatus }): Promise<NodeRow[]> {
    const { projectId, role } = this.projectContext.actor();
    const statuses = this.readableStatuses(role, filter.status);
    const nodes = await this.accountDb.transaction((tx) =>
      this.repo.listNodes(tx.db, projectId, { parentId: filter.parentId, statuses }),
    );
    return nodes;
  }

  async node(nodeId: string): Promise<NodeRow> {
    const { projectId, role } = this.projectContext.actor();
    const node = await this.accountDb.transaction((tx) => this.repo.findNode(tx.db, projectId, nodeId));
    if (!node || !this.readableStatuses(role, undefined).includes(node.status)) {
      throw new KnowledgeException(KNOWLEDGE_ERRORS.NODE_NOT_FOUND);
    }
    return node;
  }

  async create(input: {
    kind: KnowledgeNodeKind;
    title: string;
    body?: string;
    parentId?: string | null;
  }): Promise<NodeRow> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const parentId = input.parentId ?? null;
      if (parentId) {
        const parent = await this.repo.findNode(tx.db, actor.projectId, parentId);
        if (!parent || parent.kind !== 'folder') {
          throw new KnowledgeException(KNOWLEDGE_ERRORS.NODE_PARENT_INVALID);
        }
      }
      await this.assertTitleFree(tx.db, actor.projectId, parentId, input.title, null);
      const node = await this.repo.insertNode(tx.db, {
        account_id: tx.accountId,
        project_id: actor.projectId,
        parent_id: parentId,
        kind: input.kind,
        title: input.title,
        body: input.kind === 'page' ? (input.body ?? '') : '',
        status: 'draft',
        position: await this.repo.nextPosition(tx.db, actor.projectId, parentId),
        content_hash: input.kind === 'page' ? sha256(`${input.title}\n${input.body ?? ''}`) : null,
        source_id: null,
        created_by: actor.userId,
        updated_by: actor.userId,
      });
      await this.journal.record(tx, {
        actor: { type: 'user', id: actor.userId, role: actor.role },
        action: KNOWLEDGE_ACTIONS.NODE_CREATE,
        target: { type: 'knowledge_node', id: node.id },
        args: { kind: node.kind, parentId, title: node.title },
        status: 'succeeded',
      });
      await this.emitNode(tx, KNOWLEDGE_EVENTS.NODE_CREATED, actor.projectId, node.id, actor.userId);
      return node;
    });
  }

  async update(
    nodeId: string,
    input: { title?: string; body?: string; parentId?: string | null; position?: number },
  ): Promise<NodeRow> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const node = await this.repo.findNode(tx.db, actor.projectId, nodeId);
      if (!node) throw new KnowledgeException(KNOWLEDGE_ERRORS.NODE_NOT_FOUND);
      if (node.status === 'archived') {
        throw new KnowledgeException(KNOWLEDGE_ERRORS.NODE_NOT_FOUND);
      }

      if (input.parentId !== undefined && input.parentId !== node.parent_id) {
        if (input.parentId) {
          const parent = await this.repo.findNode(tx.db, actor.projectId, input.parentId);
          if (!parent || parent.kind !== 'folder') {
            throw new KnowledgeException(KNOWLEDGE_ERRORS.NODE_PARENT_INVALID);
          }
          if (await this.isDescendant(tx.db, actor.projectId, input.parentId, nodeId)) {
            throw new KnowledgeException(KNOWLEDGE_ERRORS.NODE_CYCLE);
          }
        }
      }
      const title = input.title ?? node.title;
      if (input.title && input.title !== node.title) {
        await this.assertTitleFree(tx.db, actor.projectId, input.parentId ?? node.parent_id, title, node.id);
      }
      const body = node.kind === 'folder' ? '' : (input.body ?? node.body);
      const contentChanged = title !== node.title || body !== node.body;
      // A tech edits a published page only through review: their version becomes a draft.
      const demote = node.status === 'published' && contentChanged && !canPublish(actor.role);

      const updated = await this.repo.updateNode(tx.db, actor.projectId, nodeId, {
        ...(input.title !== undefined ? { title } : {}),
        ...(node.kind === 'page' && input.body !== undefined ? { body } : {}),
        ...(input.parentId !== undefined ? { parent_id: input.parentId } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(contentChanged
          ? { content_hash: node.kind === 'page' ? sha256(`${title}\n${body}`) : node.content_hash }
          : {}),
        ...(demote ? { status: 'draft' as const, published_at: null, published_by: null } : {}),
        updated_by: actor.userId,
        updated_at: new Date(),
      });
      if (!updated) throw new KnowledgeException(KNOWLEDGE_ERRORS.NODE_NOT_FOUND);

      if (contentChanged && node.kind === 'page') {
        await this.repo.appendRevision(tx.db, {
          account_id: tx.accountId,
          node_id: node.id,
          title,
          body,
          status: updated.status,
          author_id: actor.userId,
          author_kind: 'user',
        });
      }
      await this.journal.record(tx, {
        actor: { type: 'user', id: actor.userId, role: actor.role },
        action: KNOWLEDGE_ACTIONS.NODE_UPDATE,
        target: { type: 'knowledge_node', id: node.id },
        args: { fields: Object.keys(input), status: updated.status },
        status: 'succeeded',
      });
      await this.emitNode(tx, KNOWLEDGE_EVENTS.NODE_UPDATED, actor.projectId, node.id, actor.userId);
      return updated;
    });
  }

  async publish(nodeId: string): Promise<NodeRow> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const node = await this.repo.findNode(tx.db, actor.projectId, nodeId);
      if (!node) throw new KnowledgeException(KNOWLEDGE_ERRORS.NODE_NOT_FOUND);
      if (node.kind === 'folder') throw new KnowledgeException(KNOWLEDGE_ERRORS.NODE_BODY_REQUIRED);
      if (!node.body.trim()) throw new KnowledgeException(KNOWLEDGE_ERRORS.NODE_BODY_REQUIRED);
      if (node.status === 'published') return node;
      const updated = await this.repo.updateNode(tx.db, actor.projectId, nodeId, {
        status: 'published',
        published_at: new Date(),
        published_by: actor.userId,
        updated_by: actor.userId,
        updated_at: new Date(),
        content_hash: sha256(`${node.title}\n${node.body}`),
      });
      if (!updated) throw new KnowledgeException(KNOWLEDGE_ERRORS.NODE_NOT_FOUND);
      await this.repo.appendRevision(tx.db, {
        account_id: tx.accountId,
        node_id: node.id,
        title: updated.title,
        body: updated.body,
        status: 'published',
        author_id: actor.userId,
        author_kind: 'user',
      });
      await this.journal.record(tx, {
        actor: { type: 'user', id: actor.userId, role: actor.role },
        action: KNOWLEDGE_ACTIONS.NODE_PUBLISH,
        target: { type: 'knowledge_node', id: node.id },
        args: { title: node.title },
        status: 'succeeded',
      });
      await this.emitNode(tx, KNOWLEDGE_EVENTS.NODE_PUBLISHED, actor.projectId, node.id, actor.userId);
      return updated;
    });
  }

  /** Archive hides a page from the tree and the agent search; history and revisions stay. */
  async archive(nodeId: string): Promise<NodeRow> {
    return this.changeStatus(
      nodeId,
      'archived',
      KNOWLEDGE_ACTIONS.NODE_ARCHIVE,
      KNOWLEDGE_EVENTS.NODE_ARCHIVED,
    );
  }

  async restore(nodeId: string): Promise<NodeRow> {
    return this.changeStatus(nodeId, 'draft', KNOWLEDGE_ACTIONS.NODE_RESTORE, KNOWLEDGE_EVENTS.NODE_UPDATED);
  }

  private changeStatus(
    nodeId: string,
    status: KnowledgeStatus,
    action: string,
    event: string,
  ): Promise<NodeRow> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const node = await this.repo.findNode(tx.db, actor.projectId, nodeId);
      if (!node) throw new KnowledgeException(KNOWLEDGE_ERRORS.NODE_NOT_FOUND);
      const updated = await this.repo.updateNode(tx.db, actor.projectId, nodeId, {
        status,
        ...(status === 'draft' ? { published_at: null, published_by: null } : {}),
        updated_by: actor.userId,
        updated_at: new Date(),
      });
      if (!updated) throw new KnowledgeException(KNOWLEDGE_ERRORS.NODE_NOT_FOUND);
      await this.journal.record(tx, {
        actor: { type: 'user', id: actor.userId, role: actor.role },
        action,
        target: { type: 'knowledge_node', id: node.id },
        args: {},
        status: 'succeeded',
      });
      await this.emitNode(tx, event, actor.projectId, node.id, actor.userId);
      return updated;
    });
  }

  async revisions(nodeId: string) {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const node = await this.repo.findNode(tx.db, projectId, nodeId);
      if (!node) throw new KnowledgeException(KNOWLEDGE_ERRORS.NODE_NOT_FOUND);
      return this.repo.listRevisions(tx.db, nodeId, 50);
    });
  }

  /** Restoring history is a new revision, not a rewrite: the past stays auditable. */
  async restoreRevision(nodeId: string, revision: number): Promise<NodeRow> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const node = await this.repo.findNode(tx.db, actor.projectId, nodeId);
      if (!node) throw new KnowledgeException(KNOWLEDGE_ERRORS.NODE_NOT_FOUND);
      const snapshot = await this.repo.findRevision(tx.db, nodeId, revision);
      if (!snapshot) throw new KnowledgeException(KNOWLEDGE_ERRORS.NODE_NOT_FOUND);
      const updated = await this.repo.updateNode(tx.db, actor.projectId, nodeId, {
        title: snapshot.title,
        body: snapshot.body,
        status: 'draft',
        published_at: null,
        published_by: null,
        content_hash: sha256(`${snapshot.title}\n${snapshot.body}`),
        updated_by: actor.userId,
        updated_at: new Date(),
      });
      if (!updated) throw new KnowledgeException(KNOWLEDGE_ERRORS.NODE_NOT_FOUND);
      await this.repo.appendRevision(tx.db, {
        account_id: tx.accountId,
        node_id: nodeId,
        title: snapshot.title,
        body: snapshot.body,
        status: 'draft',
        author_id: actor.userId,
        author_kind: 'user',
      });
      await this.journal.record(tx, {
        actor: { type: 'user', id: actor.userId, role: actor.role },
        action: KNOWLEDGE_ACTIONS.NODE_UPDATE,
        target: { type: 'knowledge_node', id: nodeId },
        args: { restoredRevision: revision },
        status: 'succeeded',
      });
      await this.emitNode(tx, KNOWLEDGE_EVENTS.NODE_UPDATED, actor.projectId, nodeId, actor.userId);
      return updated;
    });
  }

  // ---------------------------------------------------------------- sources

  /**
   * Stores the file content-addressed and queues extraction. The same bytes in the same
   * project return the existing source: no duplicate pages, no repeated embedding tokens.
   */
  async createSource(input: {
    kind: 'upload' | 'text';
    title?: string;
    filename?: string;
    contentBase64?: string;
    text?: string;
    periodStart?: string;
    periodEnd?: string;
    metadata?: Record<string, unknown>;
  }): Promise<SourceRow> {
    const actor = this.projectContext.actor();
    const isText = input.kind === 'text';
    const data = isText
      ? Buffer.from(input.text ?? '', 'utf8')
      : Buffer.from(input.contentBase64 ?? '', 'base64');
    if (data.length === 0) throw new KnowledgeException(KNOWLEDGE_ERRORS.SOURCE_FAILED);
    if (data.length > this.maxUploadBytes) {
      throw new KnowledgeException(KNOWLEDGE_ERRORS.SOURCE_TOO_LARGE, {
        messageArgs: { limit: Math.round(this.maxUploadBytes / 1024 / 1024) },
      });
    }
    const filename = input.filename ?? `${(input.title ?? 'заметка').slice(0, 80)}.md`;
    let format: KnowledgeFileFormat;
    try {
      format = isText ? 'md' : detectFormat(filename, data);
    } catch (error) {
      if (error instanceof UnsupportedSourceError) {
        throw new KnowledgeException(KNOWLEDGE_ERRORS.SOURCE_FORMAT_UNSUPPORTED);
      }
      throw error;
    }
    const hash = sha256(data);
    const title = (input.title ?? filename.replace(/\.[A-Za-z0-9]{1,8}$/, '')).slice(0, 200);

    return this.accountDb.transaction(async (tx) => {
      const existing = await this.repo.findSourceByHash(tx.db, actor.projectId, hash);
      if (existing) return existing;

      const blobKey = this.blobs.keyFor(tx.accountId, actor.projectId, hash, format);
      await this.blobs.put(blobKey, data);
      const source = await this.repo.insertSource(tx.db, {
        account_id: tx.accountId,
        project_id: actor.projectId,
        kind: input.kind,
        title,
        mime: mimeFor(format),
        size_bytes: data.length,
        sha256: hash,
        blob_key: blobKey,
        status: 'processing',
        period_start: input.periodStart ?? null,
        period_end: input.periodEnd ?? null,
        metadata: { ...(input.metadata ?? {}), format } as Json,
        created_by: actor.userId,
      });
      await this.journal.record(tx, {
        actor: { type: 'user', id: actor.userId, role: actor.role },
        action: KNOWLEDGE_ACTIONS.SOURCE_UPLOAD,
        target: { type: 'knowledge_source', id: source.id },
        args: { title: source.title, bytes: data.length, format },
        status: 'succeeded',
      });
      await this.emitSource(tx, KNOWLEDGE_EVENTS.SOURCE_UPLOADED, actor.projectId, source.id, actor.userId);
      return source;
    });
  }

  async sources(filter: { status?: KnowledgeSourceStatus; limit?: number }): Promise<SourceRow[]> {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction((tx) =>
      this.repo.listSources(tx.db, projectId, filter.status, Math.min(filter.limit ?? 50, 100)),
    );
  }

  async retrySource(sourceId: string): Promise<SourceRow> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const source = await this.repo.findSource(tx.db, actor.projectId, sourceId);
      if (!source) throw new KnowledgeException(KNOWLEDGE_ERRORS.SOURCE_NOT_FOUND);
      const updated = await this.repo.updateSource(tx.db, actor.projectId, sourceId, {
        status: 'processing',
        error: null,
      });
      await this.journal.record(tx, {
        actor: { type: 'user', id: actor.userId, role: actor.role },
        action: KNOWLEDGE_ACTIONS.SOURCE_RETRY,
        target: { type: 'knowledge_source', id: sourceId },
        args: {},
        status: 'succeeded',
      });
      await this.emitSource(tx, KNOWLEDGE_EVENTS.SOURCE_UPLOADED, actor.projectId, sourceId, actor.userId);
      return updated!;
    });
  }

  // ---------------------------------------------------------------- search

  /**
   * Hybrid search: full text, vectors and exact title matches, merged by Reciprocal Rank
   * Fusion and collapsed to one hit per page. Only published pages are visible.
   */
  async search(query: SearchQueryDto): Promise<{ items: SearchItem[] }> {
    const { projectId, role } = this.projectContext.actor();
    if (!this.readableStatuses(role, 'published').includes('published')) return { items: [] };
    const text = query.q.trim();
    if (!text) return { items: [] };
    const limit = Math.min(query.limit ?? KNOWLEDGE_LIMITS.searchChunks, 10);

    let vector: number[] | undefined;
    if (this.embeddings.enabled) {
      const embedded = await this.embeddings.embed([text]).catch(() => ({ vectors: [] as number[][] }));
      vector = embedded.vectors[0];
    }

    return this.accountDb.transaction(async (tx) => {
      const scope = query.parentId ? await this.repo.subtreeIds(tx.db, projectId, query.parentId) : null;
      const [fullText, semantic, titles] = await Promise.all([
        this.repo.searchFullText(tx.db, projectId, text, scope, 40),
        vector ? this.repo.searchVector(tx.db, projectId, vector, scope, 40) : Promise.resolve([]),
        this.repo.searchTitles(tx.db, projectId, text, scope, 10),
      ]);

      const merged = new Map<string, { item: SearchItem; best: SearchChunk | null }>();
      const add = (chunk: SearchChunk, rank: number) => {
        const current = merged.get(chunk.nodeId);
        if (!current) {
          merged.set(chunk.nodeId, {
            item: {
              nodeId: chunk.nodeId,
              title: chunk.title,
              headingPath: chunk.headingPath,
              snippet: snippetOf(chunk.text, text),
              score: rrf(rank),
              sourceIds: [],
              sources: [],
            },
            best: chunk,
          });
          return;
        }
        current.item.score += rrf(rank);
        if (rank < 5 && current.best?.chunkId !== chunk.chunkId)
          current.item.snippet = snippetOf(chunk.text, text);
      };
      fullText.forEach((chunk, rank) => add(chunk, rank));
      semantic.forEach((chunk, rank) => add(chunk, rank));
      for (const title of titles) {
        const current = merged.get(title.nodeId);
        if (current) current.item.score += 0.5;
      }

      const items = [...merged.values()].sort((a, b) => b.item.score - a.item.score).slice(0, limit);
      await this.attachSources(
        tx,
        items.map((entry) => entry.item),
      );
      return { items: items.map((entry) => ({ ...entry.item, score: round(entry.item.score) })) };
    });
  }

  private async attachSources(tx: AccountTx, items: SearchItem[]) {
    if (!items.length) return;
    const citations = await this.repo.citationsFor(
      tx.db,
      items.map((item) => item.nodeId),
    );
    const sourceIds = [...new Set(citations.map((citation) => citation.source_id))];
    const sources = await this.repo.findSources(tx.db, sourceIds);
    const byId = new Map(sources.map((source) => [source.id, source]));
    for (const item of items) {
      const ids = [...new Set(citations.filter((c) => c.node_id === item.nodeId).map((c) => c.source_id))];
      item.sourceIds = ids;
      item.sources = ids.flatMap((id) => {
        const source = byId.get(id);
        if (!source) return [];
        const metadata = (source.metadata ?? {}) as { limitations?: unknown };
        return [
          {
            id: source.id,
            title: source.title,
            periodStart: day(source.period_start),
            periodEnd: day(source.period_end),
            limitations: Array.isArray(metadata.limitations)
              ? metadata.limitations.filter((value): value is string => typeof value === 'string')
              : [],
          },
        ];
      });
    }
  }

  // ---------------------------------------------------------------- proposals

  async proposals(filter: { status?: KnowledgeProposalStatus }): Promise<ProposalRow[]> {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction((tx) => this.repo.listProposals(tx.db, projectId, filter.status, 50));
  }

  /** Accepting a proposal creates or edits a draft: a person still publishes it. */
  async acceptProposal(proposalId: string): Promise<ProposalRow> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const proposal = await this.repo.findProposal(tx.db, actor.projectId, proposalId);
      if (!proposal) throw new KnowledgeException(KNOWLEDGE_ERRORS.PROPOSAL_NOT_FOUND);
      if (proposal.status !== 'open') throw new KnowledgeException(KNOWLEDGE_ERRORS.PROPOSAL_CLOSED);
      const payload = (proposal.payload ?? {}) as {
        title?: string;
        body?: string;
        parentId?: string | null;
        nodeId?: string;
      };
      if (proposal.kind !== 'gap') {
        const title = (payload.title ?? '').slice(0, 120).trim();
        const body = (payload.body ?? '').slice(0, KNOWLEDGE_LIMITS.body);
        if (!title) throw new KnowledgeException(KNOWLEDGE_ERRORS.NODE_BODY_REQUIRED);
        if (payload.nodeId) {
          await this.repo.updateNode(tx.db, actor.projectId, payload.nodeId, {
            title,
            body,
            status: 'draft',
            published_at: null,
            published_by: null,
            content_hash: sha256(`${title}\n${body}`),
            updated_by: actor.userId,
            updated_at: new Date(),
          });
        } else {
          await this.repo.insertNode(tx.db, {
            account_id: tx.accountId,
            project_id: actor.projectId,
            parent_id: payload.parentId ?? null,
            kind: 'page',
            title,
            body,
            status: 'draft',
            position: await this.repo.nextPosition(tx.db, actor.projectId, payload.parentId ?? null),
            content_hash: sha256(`${title}\n${body}`),
            source_id: null,
            created_by: actor.userId,
            updated_by: actor.userId,
          });
        }
      }
      const resolved = await this.repo.resolveProposal(
        tx.db,
        actor.projectId,
        proposalId,
        'accepted',
        actor.userId,
      );
      if (!resolved) throw new KnowledgeException(KNOWLEDGE_ERRORS.PROPOSAL_CLOSED);
      await this.journal.record(tx, {
        actor: { type: 'user', id: actor.userId, role: actor.role },
        action: KNOWLEDGE_ACTIONS.PROPOSAL_ACCEPT,
        target: { type: 'knowledge_proposal', id: proposalId },
        args: { kind: proposal.kind },
        status: 'succeeded',
      });
      await this.outbox.add<KnowledgeProposalResolvedEvent>(tx, {
        type: KNOWLEDGE_EVENTS.PROPOSAL_RESOLVED,
        payload: { projectId: actor.projectId, proposalId, status: 'accepted' },
      });
      return resolved;
    });
  }

  async rejectProposal(proposalId: string): Promise<ProposalRow> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const resolved = await this.repo.resolveProposal(
        tx.db,
        actor.projectId,
        proposalId,
        'rejected',
        actor.userId,
      );
      if (!resolved) throw new KnowledgeException(KNOWLEDGE_ERRORS.PROPOSAL_NOT_FOUND);
      await this.journal.record(tx, {
        actor: { type: 'user', id: actor.userId, role: actor.role },
        action: KNOWLEDGE_ACTIONS.PROPOSAL_REJECT,
        target: { type: 'knowledge_proposal', id: proposalId },
        args: {},
        status: 'rejected',
      });
      await this.outbox.add<KnowledgeProposalResolvedEvent>(tx, {
        type: KNOWLEDGE_EVENTS.PROPOSAL_RESOLVED,
        payload: { projectId: actor.projectId, proposalId, status: 'rejected' },
      });
      return resolved;
    });
  }

  async stats() {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => ({
      ...(await this.repo.counts(tx.db, projectId)),
      chunks: await this.repo.chunkCount(tx.db, projectId),
      embeddings: this.embeddings.enabled,
    }));
  }

  // ---------------------------------------------------------------- internals

  private readableStatuses(role: AccountRole, requested?: KnowledgeStatus): KnowledgeStatus[] {
    const allowed: KnowledgeStatus[] = hasRoleAtLeast(role, 'tech')
      ? ['draft', 'published', 'archived']
      : ['published'];
    if (requested) return allowed.filter((status) => status === requested);
    return allowed;
  }

  private async assertTitleFree(
    db: Transaction<DB>,
    projectId: string,
    parentId: string | null,
    title: string,
    exceptId: string | null,
  ): Promise<void> {
    const siblings = await this.repo.listNodes(db, projectId, {
      parentId,
      statuses: ['draft', 'published', 'archived'],
    });
    const clash = siblings.some(
      (node) => node.id !== exceptId && node.title.trim().toLowerCase() === title.trim().toLowerCase(),
    );
    if (clash) throw new KnowledgeException(KNOWLEDGE_ERRORS.NODE_TITLE_TAKEN);
  }

  private async isDescendant(
    db: Transaction<DB>,
    projectId: string,
    candidateId: string,
    nodeId: string,
  ): Promise<boolean> {
    let cursor: string | null = candidateId;
    for (let depth = 0; cursor && depth < 64; depth += 1) {
      if (cursor === nodeId) return true;
      const parent: NodeRow | undefined = await this.repo.findNode(db, projectId, cursor);
      cursor = parent?.parent_id ?? null;
    }
    return false;
  }

  private async emitNode(
    tx: AccountTx,
    type: string,
    projectId: string,
    nodeId: string,
    byUserId: string | null,
  ): Promise<void> {
    await this.outbox.add<KnowledgeNodeEvent>(tx, { type, payload: { projectId, nodeId, byUserId } });
    tx.afterCommit(() => this.stream.publish(projectId, { type: 'knowledge.updated', nodeId }));
  }

  private async emitSource(
    tx: AccountTx,
    type: string,
    projectId: string,
    sourceId: string,
    byUserId: string | null,
  ): Promise<void> {
    await this.outbox.add<KnowledgeSourceEvent>(tx, { type, payload: { projectId, sourceId, byUserId } });
    tx.afterCommit(() => this.stream.publish(projectId, { type: 'knowledge.source', sourceId }));
  }
}

function canPublish(role: AccountRole): boolean {
  return hasRoleAtLeast(role, 'admin');
}

function snippetOf(text: string, query: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= 400) return flat;
  const index = flat.toLowerCase().indexOf(query.toLowerCase().split(/\s+/)[0] ?? '');
  if (index <= 200) return `${flat.slice(0, 400)}…`;
  return `…${flat.slice(Math.max(0, index - 120), index + 280)}…`;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;
