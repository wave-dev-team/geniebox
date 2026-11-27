import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import { ApiError, knowledgeApi, type KnowledgeNode } from '@/shared/api';

export const titleLimit = 120;
export const bodyLimit = 200_000;
export const uploadLimit = 20 * 1024 * 1024;
export const titleSchema = z.string().trim().min(1).max(titleLimit);
export const pageSchema = z.object({ title: titleSchema, body: z.string().max(bodyLimit) });

export function useKnowledge(accountId: string, projectId: string) {
  const client = useQueryClient();
  const api = useMemo(() => knowledgeApi(accountId, projectId), [accountId, projectId]);
  const scope = useMemo(() => ['knowledge', accountId, projectId] as const, [accountId, projectId]);
  const keys = {
    tree: [...scope, 'tree'],
    sources: [...scope, 'sources'],
    proposals: [...scope, 'proposals'],
    search: [...scope, 'search'],
    node: (id: string) => [...scope, 'node', id],
    history: (id: string) => [...scope, 'history', id],
  };
  const refreshLibrary = useCallback(() => {
    void client.invalidateQueries({ queryKey: [...scope, 'tree'] });
    void client.invalidateQueries({ queryKey: [...scope, 'search'] });
  }, [client, scope]);
  function storeNode(node: KnowledgeNode) {
    void client.cancelQueries({ queryKey: keys.node(node.id), exact: true });
    void client.cancelQueries({ queryKey: keys.tree, exact: true });
    client.setQueryData(keys.node(node.id), node);
    client.setQueryData<KnowledgeNode[]>(keys.tree, (nodes) =>
      nodes ? [...nodes.filter((item) => item.id !== node.id), node] : undefined,
    );
    void client.invalidateQueries({ queryKey: keys.history(node.id) });
    refreshLibrary();
  }
  return { api, keys, storeNode, refreshLibrary };
}

export type Knowledge = ReturnType<typeof useKnowledge>;

export function useKnowledgeError() {
  const t = useTranslations('knowledge');
  return (error: unknown) => {
    if (!(error instanceof ApiError)) return t('requestError');
    if (error.status === 403) return t('accessError');
    switch (error.code) {
      case 'KNOWLEDGE_TITLE_TAKEN':
        return t('duplicateTitle');
      case 'KNOWLEDGE_BODY_REQUIRED':
        return t('emptyBody');
      case 'KNOWLEDGE_SOURCE_TOO_LARGE':
        return t('fileTooLarge');
      case 'KNOWLEDGE_SOURCE_FORMAT_UNSUPPORTED':
        return t('fileTypeError');
      default:
        return t('requestError');
    }
  };
}

export function ancestors(id: string | null, nodes: Map<string, KnowledgeNode>) {
  const path: KnowledgeNode[] = [];
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const node = nodes.get(id);
    if (!node) break;
    path.unshift(node);
    id = node.parentId;
  }
  return path;
}

export function orderNodes(nodes: KnowledgeNode[], locale: string) {
  return [...nodes].sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, locale));
}
