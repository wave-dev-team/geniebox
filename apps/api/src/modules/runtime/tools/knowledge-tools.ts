import { z } from 'zod';

import { Injectable, type OnModuleInit } from '@nestjs/common';

import { EmbeddingsService } from '../../knowledge/embeddings.js';
import { KNOWLEDGE_LIMITS } from '../../knowledge/knowledge.constants.js';
import { KnowledgeRepository } from '../../knowledge/repositories/knowledge.repository.js';
import { defineTool, type ToolExecution } from '../broker/broker.types.js';
import { ToolError } from '../broker/tool-executor.js';
import { ToolRegistry } from '../broker/tool-registry.js';

const text = (max: number) => z.string().trim().min(1).max(max);

const searchSchema = z
  .object({
    query: text(200),
    limit: z.number().int().min(1).max(KNOWLEDGE_LIMITS.searchChunks).default(5),
  })
  .strict();

const readSchema = z.object({ nodeId: z.uuid() }).strict();
const nodeRefSchema = z.object({ nodeId: z.uuid() }).strict();
const emptySchema = z.object({}).strict();

const proposeSchema = z
  .object({
    kind: z.enum(['create', 'edit', 'gap']),
    title: text(120).optional(),
    body: text(20_000).optional(),
    nodeId: z.uuid().optional(),
    reason: text(500),
  })
  .strict();

const gapSchema = z.object({ question: text(300), reason: text(500).optional() }).strict();

/**
 * Knowledge tools of the agent. They read published pages only, return quotes with their
 * sources, and never publish: a change happens only after a person accepts a proposal.
 */
@Injectable()
export class KnowledgeTools implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly repo: KnowledgeRepository,
    private readonly embeddings: EmbeddingsService,
  ) {}

  onModuleInit(): void {
    const tools = [
      defineTool({
        id: 'knowledge.search',
        title: 'Найти в базе знаний',
        description:
          'Search the project knowledge base (published pages of the shop: research, rules, definitions, limits). Returns up to 5 quoted fragments with page ids, periods and source limitations. Cite the page id in your answer.',
        kind: 'platform',
        audience: ['agent', 'manager'],
        risk: 'low',
        mutating: false,
        schema: searchSchema,
        execute: (ctx, args) => this.search(ctx, args),
      }),
      defineTool({
        id: 'knowledge.read',
        title: 'Прочитать страницу знаний',
        description:
          'Read one published knowledge page in full by its id. Use after a search when a fragment is not enough.',
        kind: 'platform',
        audience: ['agent', 'manager'],
        risk: 'low',
        mutating: false,
        schema: readSchema,
        execute: (ctx, args) => this.read(ctx, args),
      }),
      defineTool({
        id: 'knowledge.tree',
        title: 'Оглавление знаний',
        description: 'Contents of the published knowledge base: folders and page titles.',
        kind: 'platform',
        audience: ['agent', 'manager'],
        risk: 'low',
        mutating: false,
        schema: emptySchema,
        execute: (ctx) => this.tree(ctx),
      }),
      defineTool({
        id: 'knowledge.sources',
        title: 'Источники страницы',
        description: 'Where a page came from: source titles, data periods, limitations and the exact quotes.',
        kind: 'platform',
        audience: ['agent', 'manager'],
        risk: 'low',
        mutating: false,
        schema: nodeRefSchema,
        execute: (ctx, args) => this.sources(ctx, args.nodeId),
      }),
      defineTool({
        id: 'knowledge.propose',
        title: 'Предложить знание',
        description:
          'Propose a new page, an edit or report a gap. A person reviews it; nothing changes in the tree until then.',
        kind: 'platform',
        audience: ['agent', 'manager'],
        risk: 'medium',
        mutating: false,
        schema: proposeSchema,
        execute: (ctx, args) => this.propose(ctx, args),
      }),
      defineTool({
        id: 'knowledge.report_gap',
        title: 'Сообщить о пробеле',
        description:
          'Tell the owner that the knowledge base does not answer a question you needed. Lands in the same review queue as proposals.',
        kind: 'platform',
        audience: ['agent', 'manager'],
        risk: 'low',
        mutating: false,
        schema: gapSchema,
        execute: (ctx, args) => this.reportGap(ctx, args),
      }),
    ];
    for (const tool of tools) this.registry.register(tool);
  }

  private async search(ctx: ToolExecution, args: z.infer<typeof searchSchema>) {
    const permitted = await this.publishedNodeIds(ctx);
    if (!permitted) return { items: [], note: 'в базе знаний нет опубликованных страниц' };
    let vector: number[] | undefined;
    if (this.embeddings.enabled) {
      const embedded = await this.embeddings.embed([args.query]).catch(() => ({ vectors: [] as number[][] }));
      vector = embedded.vectors[0];
    }

    const [fullText, semantic] = await Promise.all([
      this.repo.searchFullText(ctx.tx.db, ctx.projectId, args.query, null, 40),
      vector ? this.repo.searchVector(ctx.tx.db, ctx.projectId, vector, null, 40) : Promise.resolve([]),
    ]);
    const seen = new Map<string, number>();
    fullText.forEach((chunk, rank) =>
      seen.set(chunk.nodeId, (seen.get(chunk.nodeId) ?? 0) + 1 / (60 + rank)),
    );
    semantic.forEach((chunk, rank) =>
      seen.set(chunk.nodeId, (seen.get(chunk.nodeId) ?? 0) + 1 / (60 + rank)),
    );
    const ranked = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, args.limit);
    if (!ranked.length) {
      return {
        items: [],
        note: 'по этому запросу в опубликованной базе знаний ничего не найдено; проверьте оглавление через knowledge.tree или используйте более короткие ключевые слова',
      };
    }

    const citations = await this.repo.citationsFor(
      ctx.tx.db,
      ranked.map(([nodeId]) => nodeId),
    );
    const sources = await this.repo.findSources(ctx.tx.db, [
      ...new Set(citations.map((citation) => citation.source_id)),
    ]);
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    const items = [];
    for (const [nodeId, score] of ranked) {
      const chunk =
        fullText.find((item) => item.nodeId === nodeId) ?? semantic.find((item) => item.nodeId === nodeId);
      const node = await this.repo.findNode(ctx.tx.db, ctx.projectId, nodeId);
      if (!chunk || !node || node.status !== 'published') continue;
      const related = citations.filter((citation) => citation.node_id === nodeId);
      items.push({
        nodeId,
        title: node.title,
        headingPath: chunk.headingPath,
        quote: chunk.text.slice(0, 900),
        score: Math.round(score * 10_000) / 10_000,
        sources: related.flatMap((citation) => {
          const source = sourceById.get(citation.source_id);
          if (!source) return [];
          const metadata = (source.metadata ?? {}) as { limitations?: unknown };
          return [
            {
              sourceId: source.id,
              title: source.title,
              periodStart: source.period_start ? String(source.period_start).slice(0, 10) : null,
              periodEnd: source.period_end ? String(source.period_end).slice(0, 10) : null,
              limitations: Array.isArray(metadata.limitations) ? metadata.limitations : [],
            },
          ];
        }),
      });
    }
    return {
      items,
      hint: 'цитируйте nodeId; если у источника есть период или ограничения — приведите их в ответе',
    };
  }

  private async read(ctx: ToolExecution, args: z.infer<typeof readSchema>) {
    const node = await this.repo.findNode(ctx.tx.db, ctx.projectId, args.nodeId);
    if (!node || node.status !== 'published' || node.kind !== 'page') {
      throw new ToolError('KNOWLEDGE_NOT_PUBLISHED');
    }
    const citations = await this.repo.citationsFor(ctx.tx.db, [node.id]);
    return {
      nodeId: node.id,
      title: node.title,
      body: node.body.slice(0, KNOWLEDGE_LIMITS.readBody),
      truncated: node.body.length > KNOWLEDGE_LIMITS.readBody,
      updatedAt: new Date(node.updated_at).toISOString(),
      sourceIds: [...new Set(citations.map((citation) => citation.source_id))],
    };
  }

  private async tree(ctx: ToolExecution) {
    const nodes = await this.repo.publishedNodes(ctx.tx.db, ctx.projectId);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const visible = (nodeId: string | null): boolean => {
      let cursor = nodeId;
      for (let depth = 0; cursor && depth < 64; depth += 1) {
        const parent = byId.get(cursor);
        if (!parent) return false;
        if (!parent.parent_id) return true;
        cursor = parent.parent_id;
      }
      return true;
    };
    return nodes
      .filter((node) => visible(node.parent_id))
      .map((node) => ({
        nodeId: node.id,
        parentId: node.parent_id,
        title: node.title,
        kind: node.kind,
      }));
  }

  private async sources(ctx: ToolExecution, nodeId: string) {
    const node = await this.repo.findNode(ctx.tx.db, ctx.projectId, nodeId);
    if (!node || node.status !== 'published') throw new ToolError('KNOWLEDGE_NOT_PUBLISHED');
    const citations = await this.repo.citationsFor(ctx.tx.db, [nodeId]);
    const sources = await this.repo.findSources(ctx.tx.db, [...new Set(citations.map((c) => c.source_id))]);
    return {
      nodeId,
      citations: citations.map((citation) => {
        const source = sources.find((item) => item.id === citation.source_id);
        return {
          sourceId: citation.source_id,
          title: source?.title ?? null,
          periodStart: source?.period_start ? String(source.period_start).slice(0, 10) : null,
          periodEnd: source?.period_end ? String(source.period_end).slice(0, 10) : null,
          locator: citation.locator,
          quote: citation.quote,
        };
      }),
    };
  }

  private async propose(ctx: ToolExecution, args: z.infer<typeof proposeSchema>) {
    if (args.kind !== 'gap' && !args.title) throw new ToolError('KNOWLEDGE_TITLE_REQUIRED');
    if (args.nodeId) {
      const node = await this.repo.findNode(ctx.tx.db, ctx.projectId, args.nodeId);
      if (!node) throw new ToolError('KNOWLEDGE_NOT_FOUND');
    }
    const proposal = await this.repo.insertProposal(ctx.tx.db, {
      account_id: ctx.accountId,
      project_id: ctx.projectId,
      agent_id: ctx.agent.id,
      kind: args.kind,
      payload: {
        title: args.title ?? null,
        body: args.body ?? null,
        nodeId: args.nodeId ?? null,
        reason: args.reason,
      },
    });
    return { proposalId: proposal.id, status: 'open', note: 'предложение ждёт решения человека' };
  }

  private async reportGap(ctx: ToolExecution, args: z.infer<typeof gapSchema>) {
    const proposal = await this.repo.insertProposal(ctx.tx.db, {
      account_id: ctx.accountId,
      project_id: ctx.projectId,
      agent_id: ctx.agent.id,
      kind: 'gap',
      payload: { question: args.question, reason: args.reason ?? null },
    });
    return { proposalId: proposal.id, status: 'open' };
  }

  /** A guard against searching before the first page is published. */
  private async publishedNodeIds(ctx: ToolExecution): Promise<boolean> {
    const nodes = await this.repo.publishedNodes(ctx.tx.db, ctx.projectId);
    return nodes.some((node) => node.kind === 'page');
  }
}
