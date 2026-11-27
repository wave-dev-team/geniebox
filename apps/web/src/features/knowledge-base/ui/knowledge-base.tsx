'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Folder } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { Input } from '@workspace/ui/components/input';
import { Skeleton } from '@workspace/ui/components/skeleton';
import { Textarea } from '@workspace/ui/components/textarea';

import { useActiveProject } from '@/entities/project';
import { hasRoleAtLeast } from '@/entities/workspace';
import { knowledgeApi, type KnowledgeNode } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/** Ordered tree flattened for rendering; children keep their position. */
function flatten(nodes: KnowledgeNode[]): Array<{ node: KnowledgeNode; depth: number }> {
  const byParent = new Map<string | null, KnowledgeNode[]>();
  for (const node of nodes) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, 'ru'));
  }
  const out: Array<{ node: KnowledgeNode; depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const node of byParent.get(parentId) ?? []) {
      out.push({ node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function KnowledgeBase() {
  const t = useTranslations('knowledge');
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const { directory, account, project } = useActiveProject();
  const role = directory.active?.role;
  const canEdit = hasRoleAtLeast(role, 'tech');
  const canPublish = hasRoleAtLeast(role, 'admin');
  const api = useMemo(
    () => (account && project ? knowledgeApi(account.id, project.id) : null),
    [account, project],
  );

  const scope = [account?.id, project?.id] as const;
  const treeKey = ['knowledge-tree', ...scope];
  const sourcesKey = ['knowledge-sources', ...scope];
  const proposalsKey = ['knowledge-proposals', ...scope];
  const statsKey = ['knowledge-stats', ...scope];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');

  const tree = useQuery({
    queryKey: treeKey,
    queryFn: ({ signal }) => api!.tree(signal),
    enabled: Boolean(api),
  });
  const stats = useQuery({
    queryKey: statsKey,
    queryFn: ({ signal }) => api!.stats(signal),
    enabled: Boolean(api),
  });
  const sources = useQuery({
    queryKey: sourcesKey,
    queryFn: ({ signal }) => api!.sources(signal),
    enabled: Boolean(api) && canEdit,
  });
  const proposals = useQuery({
    queryKey: proposalsKey,
    queryFn: ({ signal }) => api!.proposals(signal),
    enabled: Boolean(api) && canEdit,
  });
  const selected = useQuery({
    queryKey: ['knowledge-node', ...scope, selectedId],
    queryFn: ({ signal }) => api!.node(selectedId!, signal),
    enabled: Boolean(api) && Boolean(selectedId),
  });
  const search = useQuery({
    queryKey: ['knowledge-search', ...scope, submitted],
    queryFn: ({ signal }) => api!.search(submitted, signal),
    enabled: Boolean(api) && submitted.length > 0,
  });

  const rows = useMemo(() => flatten(tree.data ?? []), [tree.data]);
  const current = selected.data;

  useEffect(() => {
    if (!current) return;
    setTitle(current.title);
    setBody(current.body);
  }, [current?.id, current?.updatedAt, current?.title, current?.body]);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: treeKey });
    void client.invalidateQueries({ queryKey: statsKey });
  };

  const create = useMutation({
    mutationFn: (kind: 'page' | 'folder') =>
      api!.createNode({
        kind,
        title: newTitle.trim(),
        parentId: current?.kind === 'folder' ? current.id : (current?.parentId ?? null),
      }),
    onSuccess: (node) => {
      setNewTitle('');
      setSelectedId(node.id);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const save = useMutation({
    mutationFn: () =>
      api!.updateNode(selectedId!, {
        ...(current?.kind === 'page' ? { body } : {}),
        ...(title.trim() && title.trim() !== current?.title ? { title: title.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success(t('saved'));
      refresh();
      void client.invalidateQueries({ queryKey: ['knowledge-node', ...scope, selectedId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const publish = useMutation({
    mutationFn: () => api!.publish(selectedId!),
    onSuccess: () => {
      toast.success(t('published'));
      refresh();
      void client.invalidateQueries({ queryKey: ['knowledge-node', ...scope, selectedId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const setStatus = useMutation({
    mutationFn: (status: 'archive' | 'restore') =>
      status === 'archive' ? api!.archive(selectedId!) : api!.restore(selectedId!),
    onSuccess: () => {
      refresh();
      void client.invalidateQueries({ queryKey: ['knowledge-node', ...scope, selectedId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const contentBase64 = await toBase64(file);
      return api!.createSource({ kind: 'upload', filename: file.name, title: file.name, contentBase64 });
    },
    onSuccess: () => {
      toast.success(t('uploading'));
      void client.invalidateQueries({ queryKey: sourcesKey });
      void client.invalidateQueries({ queryKey: statsKey });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const paste = useMutation({
    mutationFn: () =>
      api!.createSource({
        kind: 'text',
        title: pasteTitle.trim() || t('title'),
        filename: `${(pasteTitle.trim() || 'note').slice(0, 60)}.md`,
        text: pasteText,
      }),
    onSuccess: () => {
      setPasteText('');
      setPasteTitle('');
      void client.invalidateQueries({ queryKey: sourcesKey });
      void client.invalidateQueries({ queryKey: statsKey });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const retry = useMutation({
    mutationFn: (id: string) => api!.retrySource(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: sourcesKey }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const resolve = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      accept ? api!.acceptProposal(id) : api!.rejectProposal(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: proposalsKey });
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!api) return <Skeleton className="h-64" />;

  return (
    <main className="mx-auto flex w-full max-w-200 flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        <p className="text-xs text-muted-foreground">
          {t('stats', {
            drafts: stats.data?.drafts ?? 0,
            published: stats.data?.published ?? 0,
            chunks: stats.data?.chunks ?? 0,
          })}
          {stats.data && !stats.data.embeddings ? ` · ${t('searchHint')}` : ''}
        </p>
      </header>

      <section className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            className="min-w-0 flex-1"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && query.trim()) setSubmitted(query.trim());
            }}
            placeholder={t('searchPlaceholder')}
          />
          <Button variant="outline" onClick={() => setSubmitted(query.trim())} disabled={!query.trim()}>
            {t('search')}
          </Button>
        </div>
        {search.isFetching && <Skeleton className="h-16" />}
        {submitted && search.data?.items.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('nothingFound')}</p>
        )}
        {search.data?.items.map((item) => (
          <button
            key={item.nodeId}
            type="button"
            className="rounded-md border p-3 text-left text-sm hover:bg-muted"
            onClick={() => setSelectedId(item.nodeId)}
          >
            <span className="font-medium">{item.title}</span>
            {item.headingPath.at(-1) !== item.title && (
              <span className="ml-2 text-xs text-muted-foreground">{item.headingPath.at(-1)}</span>
            )}
            <p className="mt-1 line-clamp-3 text-muted-foreground">{item.snippet}</p>
            {item.sources.some((source) => source.limitations.length > 0) && (
              <p className="mt-1 text-xs text-amber-600">
                {item.sources.flatMap((source) => source.limitations).join(' · ')}
              </p>
            )}
          </button>
        ))}
      </section>

      {!canEdit && <p className="text-sm text-muted-foreground">{t('readOnly')}</p>}

      <div className="grid gap-4 md:grid-cols-[280px_1fr]">
        <aside className="flex min-w-0 flex-col gap-3">
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Input
                className="min-w-0 flex-1 basis-full sm:basis-0"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder={t('titlePlaceholder')}
              />
              <Button
                size="sm"
                disabled={!newTitle.trim() || create.isPending}
                onClick={() => create.mutate('page')}
              >
                {t('newPage')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!newTitle.trim() || create.isPending}
                onClick={() => create.mutate('folder')}
              >
                {t('newFolder')}
              </Button>
            </div>
          )}

          {tree.isLoading ? (
            <Skeleton className="h-40" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="flex flex-col gap-0.5 text-sm">
              {rows.map(({ node, depth }) => (
                <li key={node.id}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-muted ${
                      node.id === selectedId ? 'bg-muted font-medium' : ''
                    } ${node.status === 'archived' ? 'text-muted-foreground line-through' : ''}`}
                    style={{ paddingLeft: `${8 + depth * 14}px` }}
                    onClick={() => setSelectedId(node.id)}
                  >
                    {node.kind === 'folder' && (
                      <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span className="truncate">{node.title}</span>
                    {node.status !== 'published' && (
                      <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
                        {t(`status.${node.status}`)}
                      </Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <details className="rounded-md border p-2 text-sm">
              <summary className="cursor-pointer font-medium">{t('sources')}</summary>
              <div className="mt-2 flex flex-col gap-2">
                <label className="flex cursor-pointer flex-col gap-1 text-xs text-muted-foreground">
                  <span>{t('upload')}</span>
                  <input
                    type="file"
                    accept=".md,.txt,.csv,.xlsx"
                    className="text-xs"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) upload.mutate(file);
                      event.target.value = '';
                    }}
                  />
                  <span>{t('uploadHint')}</span>
                </label>
                <details>
                  <summary className="cursor-pointer text-xs">{t('paste')}</summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <Input
                      value={pasteTitle}
                      onChange={(event) => setPasteTitle(event.target.value)}
                      placeholder={t('pasteTitle')}
                    />
                    <Textarea
                      value={pasteText}
                      onChange={(event) => setPasteText(event.target.value)}
                      rows={4}
                    />
                    <Button
                      size="sm"
                      disabled={!pasteText.trim() || paste.isPending}
                      onClick={() => paste.mutate()}
                    >
                      {t('paste')}
                    </Button>
                  </div>
                </details>
                {(sources.data ?? []).map((source) => (
                  <div key={source.id} className="flex flex-col gap-1 border-t pt-1 text-xs">
                    <span className="truncate font-medium">{source.title}</span>
                    <span className="text-muted-foreground">
                      {source.status === 'processing'
                        ? t('processing')
                        : source.status === 'failed'
                          ? `${t('failed')}: ${source.error ?? ''}`
                          : `${t('publishedAt')} ${source.periodStart ?? '—'} – ${source.periodEnd ?? '—'}`}
                    </span>
                    {source.status === 'failed' && (
                      <Button size="sm" variant="outline" onClick={() => retry.mutate(source.id)}>
                        {t('retry')}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}

          {canPublish && (proposals.data ?? []).length > 0 && (
            <details className="rounded-md border p-2 text-sm">
              <summary className="cursor-pointer font-medium">
                {t('proposals')} ({proposals.data?.length})
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                {proposals.data?.map((proposal) => (
                  <div key={proposal.id} className="flex flex-col gap-1 border-t pt-2 text-xs">
                    <span className="font-medium">
                      {String(proposal.payload.title ?? proposal.payload.question ?? proposal.kind)}
                    </span>
                    <span className="text-muted-foreground">{String(proposal.payload.reason ?? '')}</span>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => resolve.mutate({ id: proposal.id, accept: true })}>
                        {t('accept')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resolve.mutate({ id: proposal.id, accept: false })}
                      >
                        {t('reject')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </aside>

        <section className="flex min-w-0 flex-col gap-3">
          {!selectedId || !current ? (
            <p className="text-sm text-muted-foreground">{t('select')}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={!canEdit}
                  className="max-w-md"
                />
                <Badge variant="outline">{t(`status.${current.status}`)}</Badge>
                {current.kind === 'page' && (
                  <Badge variant="outline">{current.body.length.toLocaleString('ru')} сим.</Badge>
                )}
                {canEdit && (
                  <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                    {t('save')}
                  </Button>
                )}
                {canPublish && current.status !== 'published' && current.kind === 'page' && (
                  <Button
                    size="sm"
                    onClick={() => publish.mutate()}
                    disabled={!body.trim() || publish.isPending}
                  >
                    {t('publish')}
                  </Button>
                )}
                {canPublish && current.status !== 'archived' && (
                  <Button size="sm" variant="outline" onClick={() => setStatus.mutate('archive')}>
                    {t('archive')}
                  </Button>
                )}
                {canPublish && current.status === 'archived' && (
                  <Button size="sm" variant="outline" onClick={() => setStatus.mutate('restore')}>
                    {t('restore')}
                  </Button>
                )}
              </div>
              {current.kind === 'page' ? (
                <Textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  disabled={!canEdit}
                  rows={24}
                  placeholder={t('bodyPlaceholder')}
                  className="min-h-[50vh] font-mono text-sm"
                />
              ) : (
                <p className="text-sm text-muted-foreground">{t('empty')}</p>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
