import { describe, expect, it } from '@jest/globals';

import type { CatalogService } from '../../catalog/catalog.service.js';
import type { EmbeddingsService } from '../../knowledge/embeddings.js';
import type { KnowledgeRepository } from '../../knowledge/repositories/knowledge.repository.js';
import type { ToolExecution } from '../broker/broker.types.js';
import { ToolRegistry } from '../broker/tool-registry.js';
import { KnowledgeTools } from './knowledge-tools.js';

describe('knowledge.read', () => {
  const nodeId = '00000000-0000-4000-8000-000000000001';
  const row = '| R-09 | Test release |';
  const body = `${'Earlier row\n'.repeat(300)}${row}`;
  const registry = new ToolRegistry({} as CatalogService);
  const repo = {
    findNode: async () => ({
      id: nodeId,
      title: 'Releases',
      kind: 'page',
      status: 'published',
      body,
      updated_at: new Date(0),
    }),
    citationsFor: async () => [],
  } as unknown as KnowledgeRepository;
  new KnowledgeTools(registry, repo, {} as EmbeddingsService).onModuleInit();
  const read = registry.get('knowledge.read')!;
  const context = { tx: { db: {} }, projectId: 'project' } as ToolExecution;

  it('finds an exact release identifier beyond the first tool result', async () => {
    const result = await read.execute!(context, read.schema.parse({ nodeId, query: 'r-09' }));
    expect(result).toMatchObject({
      body: row,
      nextOffset: null,
      truncated: false,
      url: `/knowledge?page=${nodeId}`,
    });
  });

  it('can retrieve the rest of a long page using nextOffset', async () => {
    let contents = '';
    let offset: number | null = 0;
    do {
      const result = (await read.execute!(context, read.schema.parse({ nodeId, offset }))) as {
        body: string;
        nextOffset: number | null;
      };
      expect(JSON.stringify(result).length).toBeLessThan(3000);
      contents += result.body;
      offset = result.nextOffset;
    } while (offset !== null);
    expect(contents).toBe(body);
  });
});
