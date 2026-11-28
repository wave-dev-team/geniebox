import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { AccountDb } from '../../database/scoped-db.js';
import { JournalService } from '../../journal/journal.service.js';
import { BlobStore } from './blob-store.js';
import { chunkPage } from './chunker.js';
import { EmbeddingsService } from './embeddings.js';
import { detectFormat, extractDocument } from './extract.js';
import { KNOWLEDGE_FILE_FORMATS } from './knowledge.constants.js';
import type { NodeRow } from './repositories/knowledge.repository.js';
import { KnowledgeRepository } from './repositories/knowledge.repository.js';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Turns a published page into search chunks and a source into draft pages. Network calls to
 * the embedding provider happen between two short transactions, never inside one.
 */
@Injectable()
export class KnowledgeIndexingService {
  private readonly logger = new Logger(KnowledgeIndexingService.name);

  constructor(
    private readonly accountDb: AccountDb,
    private readonly repo: KnowledgeRepository,
    private readonly embeddings: EmbeddingsService,
    private readonly blobs: BlobStore,
    private readonly journal: JournalService,
  ) {}

  /** Rebuilds the index of one page; an archived or unpublished page simply loses its chunks. */
  async indexNode(projectId: string, nodeId: string): Promise<void> {
    const node = await this.accountDb.transaction((tx) => this.repo.findNode(tx.db, projectId, nodeId));
    if (!node || node.status !== 'published' || node.kind === 'folder') {
      await this.accountDb.transaction((tx) => this.repo.deleteChunks(tx.db, nodeId));
      return;
    }
    // Unchanged content is not re-chunked and never spends embedding tokens again.
    if (node.indexed_hash && node.indexed_hash === node.content_hash) return;
    const drafts = chunkPage(node.title, node.body);
    if (!drafts.length) {
      await this.accountDb.transaction((tx) => this.repo.deleteChunks(tx.db, nodeId));
      return;
    }

    const inputs = drafts.map((draft) => `${draft.headingPath.join(' > ')}\n${draft.text}`);
    const embedded = await this.embeddings.embed(inputs).catch((error: unknown) => {
      // Search stays useful on full text alone; the pages are indexed again on the next publish.
      this.logger.warn({ err: error, nodeId }, 'embeddings unavailable, indexing text only');
      return { vectors: [] as number[][], tokens: 0 };
    });

    await this.accountDb.transaction(async (tx) => {
      const current = await this.repo.findNode(tx.db, projectId, nodeId);
      if (!current || current.status !== 'published' || current.content_hash !== node.content_hash) return;
      await this.repo.updateNode(tx.db, projectId, nodeId, { indexed_hash: node.content_hash });
      await this.repo.replaceChunks(
        tx.db,
        nodeId,
        drafts.map((draft, index) => ({
          account_id: tx.accountId,
          project_id: projectId,
          node_id: nodeId,
          position: index,
          heading_path: draft.headingPath,
          text: draft.text,
          token_count: draft.tokenCount,
          content_hash: sha256(draft.text),
          embedding: embedded.vectors[index]
            ? `[${embedded.vectors[index]!.map((value) => value.toFixed(6)).join(',')}]`
            : null,
          embedding_model: embedded.vectors[index] ? this.embeddings.model : null,
        })),
      );
      await this.journal.record(tx, {
        actor: { type: 'system', id: nodeId },
        action: 'knowledge.index',
        target: { type: 'knowledge_node', id: nodeId },
        args: {
          chunks: drafts.length,
          embeddingTokens: Math.ceil(embedded.tokens),
          model: this.embeddings.model,
        },
        status: 'succeeded',
      });
    });
  }

  /**
   * Extracts a source and creates one draft folder with draft pages. Nothing is published:
   * a person reviews the extraction first. Re-processing replaces the previous drafts.
   */
  async processSource(projectId: string, sourceId: string): Promise<void> {
    const source = await this.accountDb.transaction((tx) => this.repo.findSource(tx.db, projectId, sourceId));
    if (!source) return;
    const data = await this.blobs.get(source.blob_key);
    // The format was decided by the extension at upload time; the title is editable and has none.
    const stored = (source.metadata as { format?: string }).format;
    const format =
      KNOWLEDGE_FILE_FORMATS.find((value) => value === stored) ?? detectFormat(source.blob_key, data);
    const document = await extractDocument(format, source.title, data);

    const pageIds: string[] = [];

    await this.accountDb.transaction(async (tx) => {
      const previous = await this.repo.listNodes(tx.db, projectId, {
        parentId: undefined,
        statuses: ['draft', 'published'],
      });
      const root = previous.find(
        (node) => node.source_id === sourceId && node.kind === 'folder' && node.parent_id === null,
      );
      let parentId: string | null;
      if (root) {
        parentId = root.id;
        // Drafts of this source are replaced, never accumulated on retry.
        const children = previous.filter((node) => node.parent_id === root!.id);
        if (children.length) {
          const ids = children.map((node) => node.id);
          await tx.db.deleteFrom('knowledge_citations').where('node_id', 'in', ids).execute();
          await tx.db.deleteFrom('knowledge_chunks').where('node_id', 'in', ids).execute();
          await tx.db.deleteFrom('knowledge_revisions').where('node_id', 'in', ids).execute();
          await tx.db.deleteFrom('knowledge_nodes').where('id', 'in', ids).execute();
        }
      } else {
        const folder = await this.repo.insertNode(tx.db, {
          account_id: tx.accountId,
          project_id: projectId,
          parent_id: null,
          kind: 'folder',
          title: document.title.slice(0, 120),
          body: '',
          status: 'published',
          position: 0,
          content_hash: null,
          source_id: sourceId,
          created_by: source.created_by,
          updated_by: source.created_by,
        });
        parentId = folder.id;
      }

      const pages = groupParts(document.parts);
      let position = await this.repo.nextPosition(tx.db, projectId, parentId);
      for (const page of pages) {
        const node = await this.repo.insertNode(tx.db, {
          account_id: tx.accountId,
          project_id: projectId,
          parent_id: parentId,
          kind: 'page',
          title: page.title.slice(0, 120),
          body: page.text.slice(0, 180_000),
          status: 'published',
          position,
          content_hash: sha256(`${page.title}\n${page.text}`),
          source_id: sourceId,
          created_by: source.created_by,
          updated_by: source.created_by,
        });
        pageIds.push(node.id);
        position += 1;
        await this.repo.replaceCitations(
          tx.db,
          node.id,
          page.parts.map((part) => ({
            account_id: tx.accountId,
            source_id: sourceId,
            locator: part.locator,
            quote: part.text.slice(0, 500),
          })),
        );
      }

      await this.repo.updateSource(tx.db, projectId, sourceId, {
        status: 'ready',
        error: null,
        metadata: { ...(source.metadata as object), format, pages: pages.length },
      });
      await this.journal.record(tx, {
        actor: { type: 'system', id: sourceId },
        action: 'knowledge.source.processed',
        target: { type: 'knowledge_source', id: sourceId },
        args: { pages: pages.length, format },
        status: 'succeeded',
      });
    });

    for (const pageId of pageIds) {
      await this.indexNode(projectId, pageId);
    }
  }

  /** Draft pages produced by a source, for the person to review. */
  draftsOfSource(nodes: NodeRow[], sourceId: string): NodeRow[] {
    return nodes.filter((node) => node.source_id === sourceId && node.kind === 'page');
  }
}

interface PageDraft {
  title: string;
  text: string;
  parts: Array<{ text: string; locator: Record<string, string | number | null> }>;
}

/** Consecutive parts of one sheet or heading become a single page. */
function groupParts(
  parts: Array<{ headingPath: string[]; text: string; locator: Record<string, string | number | null> }>,
): PageDraft[] {
  const pages: PageDraft[] = [];
  const used = new Map<string, number>();
  for (const part of parts) {
    const key = part.headingPath.join(' > ');
    const existing = used.has(key) ? pages[used.get(key)!] : undefined;
    if (existing && existing.text.length + part.text.length < 180_000) {
      existing.text += `\n\n${part.text}`;
      existing.parts.push({ text: part.text, locator: part.locator });
      continue;
    }
    const base = (part.headingPath.at(-1) ?? 'Страница').trim().slice(0, 120) || 'Страница';
    const duplicate = pages.filter((page) => page.title.startsWith(base)).length;
    const title = duplicate ? `${base.slice(0, 112)} (${duplicate + 1})` : base;
    pages.push({ title, text: part.text, parts: [{ text: part.text, locator: part.locator }] });
    used.set(key, pages.length - 1);
  }
  return pages;
}
