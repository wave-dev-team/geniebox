'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronDown, FilePlus2, FileText, FolderPlus, LibraryBig, Plus, Upload } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@workspace/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu';
import { Skeleton } from '@workspace/ui/components/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs';

import { ancestors, orderNodes, useKnowledge } from '../model/knowledge';
import { KnowledgeBreadcrumbs } from './knowledge-breadcrumbs';
import { CreateNodeDialog } from './knowledge-dialogs';
import { KnowledgeList } from './knowledge-list';
import { KnowledgeProposals } from './knowledge-proposals';
import { KnowledgeSearch } from './knowledge-search';
import { ImportSourceDialog, KnowledgeSources, type SourceKind } from './knowledge-sources';
import { EmptyState, LoadError } from './knowledge-ui';
import { NodeDetail } from './node-detail';

import { useActiveProject } from '@/entities/project';
import { hasRoleAtLeast } from '@/entities/workspace';
import type { KnowledgeNode } from '@/shared/api';

const emptyNodes: KnowledgeNode[] = [];
const idSchema = z.uuid();
type View = 'pages' | 'sources' | 'proposals';
type Filter = 'active' | 'draft' | 'archived';
type Action =
  | { type: 'create'; kind: 'page' | 'folder'; parent?: KnowledgeNode }
  | { type: 'import'; kind: SourceKind }
  | { type: 'search' };

export function KnowledgeBase() {
  const t = useTranslations('knowledge');
  const { account, project, projects } = useActiveProject();
  if (account && project) {
    return (
      <KnowledgeWorkspace
        key={`${account.id}/${project.id}`}
        accountId={account.id}
        projectId={project.id}
        canEdit={hasRoleAtLeast(account.role, 'tech')}
        canPublish={hasRoleAtLeast(account.role, 'admin')}
      />
    );
  }
  return (
    <main className="mx-auto w-full max-w-300 px-4 pt-16 pb-8 sm:px-8">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      {projects.isError ? (
        <LoadError retry={() => void projects.refetch()} />
      ) : account && !projects.isPending ? (
        <EmptyState icon={LibraryBig} title={t('noProject')} />
      ) : (
        <Skeleton className="mt-5 h-56 rounded-2xl" />
      )}
    </main>
  );
}

function KnowledgeWorkspace({
  accountId,
  projectId,
  canEdit,
  canPublish,
}: {
  accountId: string;
  projectId: string;
  canEdit: boolean;
  canPublish: boolean;
}) {
  const t = useTranslations('knowledge');
  const locale = useLocale();
  const knowledge = useKnowledge(accountId, projectId);
  const params = useSearchParams();
  const requestedView = params.get('view');
  const view: View =
    canEdit && (requestedView === 'sources' || requestedView === 'proposals') ? requestedView : 'pages';
  const selectedId = idSchema.safeParse(params.get('page')).data ?? null;
  const sourceId = params.get('source');
  const [filter, setFilter] = useState<Filter>('active');
  const [action, setAction] = useState<Action | null>(null);
  const [editOnOpen, setEditOnOpen] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const importing = useRef(new Set<string>());
  const actionTrigger = useRef<HTMLElement | null>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const libraryHeading = useRef<HTMLHeadingElement>(null);
  const returnToLibrary = useRef(false);
  const tree = useQuery({
    queryKey: knowledge.keys.tree,
    queryFn: ({ signal }) => knowledge.api.tree(signal),
  });
  const selected = useQuery({
    queryKey: knowledge.keys.node(selectedId ?? ''),
    queryFn: ({ signal }) => knowledge.api.node(selectedId!, signal),
    enabled: Boolean(selectedId) && view === 'pages',
  });
  const sources = useQuery({
    queryKey: knowledge.keys.sources,
    queryFn: ({ signal }) => knowledge.api.sources(signal),
    enabled: canEdit,
    refetchInterval: ({ state }) =>
      state.data?.some((source) => source.status === 'processing') ? 3000 : false,
  });
  const proposals = useQuery({
    queryKey: knowledge.keys.proposals,
    queryFn: ({ signal }) => knowledge.api.proposals(signal),
    enabled: canEdit,
  });
  const nodes = tree.data ?? emptyNodes;
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const current = selected.data ?? byId.get(selectedId ?? '');
  const selectedSource = sources.data?.find((source) => source.id === current?.sourceId);

  const { refreshLibrary } = knowledge;
  useEffect(() => {
    if (!sources.data) return;
    for (const source of sources.data) {
      if (source.status === 'processing') importing.current.add(source.id);
      if (source.status === 'processing' || !importing.current.delete(source.id)) continue;
      refreshLibrary();
      if (source.status === 'ready') toast.success(t('sourceReady', { title: source.title }));
      if (source.status === 'failed') toast.error(t('sourceFailed', { title: source.title }));
    }
  }, [refreshLibrary, sources.data, t]);

  function navigate(nextView: View, options: { page?: string; source?: string } = {}) {
    if (locked) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    url.searchParams.delete('page');
    url.searchParams.delete('source');
    if (nextView !== 'pages') url.searchParams.set('view', nextView);
    if (options.page) url.searchParams.set('page', options.page);
    if (options.source) url.searchParams.set('source', options.source);
    if (url.href !== window.location.href) window.history.pushState(null, '', url);
  }

  useEffect(() => {
    mainRef.current?.scrollIntoView({ block: 'start' });
    if (!selectedId && returnToLibrary.current) {
      returnToLibrary.current = false;
      libraryHeading.current?.focus({ preventScroll: true });
    }
  }, [selectedId, view]);

  useEffect(() => {
    if (!locked) return;
    const editingUrl = window.location.href;
    const path = window.location.pathname;
    function stayOnPage() {
      if (window.location.pathname === path && window.location.href !== editingUrl) {
        window.history.pushState(null, '', editingUrl);
      }
    }
    window.addEventListener('popstate', stayOnPage);
    return () => window.removeEventListener('popstate', stayOnPage);
  }, [locked]);

  function backToPages() {
    returnToLibrary.current = true;
    setEditOnOpen(null);
    navigate('pages');
  }

  function open(id: string) {
    if (selectedId !== id) setEditOnOpen(null);
    navigate('pages', { page: id });
  }

  function openAction(next: Action, trigger?: HTMLElement | null) {
    const focused = document.activeElement;
    actionTrigger.current =
      trigger ??
      (focused instanceof HTMLElement && focused !== document.body ? focused : createTrigger.current);
    setAction(next);
  }

  function closeAction(restoreFocus = true) {
    setAction(null);
    if (restoreFocus) window.requestAnimationFrame(() => actionTrigger.current?.focus());
  }

  function create(
    kind: 'page' | 'folder',
    from: KnowledgeNode | undefined = view === 'pages' ? current : undefined,
    trigger?: HTMLElement | null,
  ) {
    const parent = from?.kind === 'folder' ? from : byId.get(from?.parentId ?? '');
    openAction({ type: 'create', kind, parent: parent?.status === 'archived' ? undefined : parent }, trigger);
  }

  const listing = orderNodes(
    nodes.filter((node) => {
      if (filter === 'draft') return node.kind === 'page' && node.status === 'draft';
      if (filter === 'archived') return node.status === 'archived';
      const parent = byId.get(node.parentId ?? '');
      return node.status !== 'archived' && (!parent || parent.status === 'archived');
    }),
    locale,
  );
  const locations =
    filter === 'active'
      ? undefined
      : new Map(
          listing.map((node) => [
            node.id,
            ancestors(node.parentId, byId)
              .map((parent) => parent.title)
              .join(' / '),
          ]),
        );
  const proposalCount = proposals.data?.length ?? 0;
  const createMenu = canEdit && (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button ref={createTrigger} size="lg" disabled={locked} />}>
        <Plus aria-hidden="true" />
        {t('create')}
        <ChevronDown aria-hidden="true" className="size-3.5!" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem
          onClick={() => create('page', view === 'pages' ? current : undefined, createTrigger.current)}
        >
          <FilePlus2 aria-hidden="true" />
          {t('newPage')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => create('folder', view === 'pages' ? current : undefined, createTrigger.current)}
        >
          <FolderPlus aria-hidden="true" />
          {t('newFolder')}
        </DropdownMenuItem>
        {!current && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => openAction({ type: 'import', kind: 'upload' }, createTrigger.current)}
            >
              <Upload aria-hidden="true" />
              {t('upload')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => openAction({ type: 'import', kind: 'text' }, createTrigger.current)}
            >
              <FileText aria-hidden="true" />
              {t('paste')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <main
      ref={mainRef}
      className="mx-auto flex w-full max-w-300 flex-col gap-6 px-4 pt-16 pb-8 sm:px-8 lg:px-10"
    >
      <KnowledgeBreadcrumbs
        selected={Boolean(selectedId)}
        parents={ancestors(current?.parentId ?? null, byId)}
        currentTitle={current?.title}
        locked={locked}
        onRoot={backToPages}
        onOpen={open}
        onSearch={(event) => openAction({ type: 'search' }, event.currentTarget)}
      />
      {view === 'pages' && selectedId ? (
        current && !selected.isError ? (
          <NodeDetail
            key={current.id}
            knowledge={knowledge}
            node={current}
            nodes={nodes}
            byId={byId}
            canEdit={canEdit}
            canPublish={canPublish}
            startEditing={editOnOpen === current.id}
            source={selectedSource}
            onOpen={open}
            folderActions={createMenu}
            onSources={() => navigate('sources', { source: current.sourceId ?? undefined })}
            onBlockingChange={setLocked}
          />
        ) : selected.isError ? (
          <LoadError retry={() => void selected.refetch()} />
        ) : (
          <Skeleton className="h-40" />
        )
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-4">
            <h1
              ref={libraryHeading}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight outline-none"
            >
              {t('title')}
            </h1>
            {view === 'pages' && createMenu}
          </header>
          <Tabs
            value={view}
            className="gap-3"
            onValueChange={(value) => {
              if (value === 'pages' || value === 'sources' || value === 'proposals') navigate(value);
            }}
          >
            {canEdit && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TabsList aria-label={t('sections')} className="max-w-full">
                  <TabsTrigger value="pages">{t('pages')}</TabsTrigger>
                  <TabsTrigger value="sources">{t('sources')}</TabsTrigger>
                  <TabsTrigger value="proposals">
                    <span className="sm:hidden">{t('proposalsShort')}</span>
                    <span className="hidden sm:inline">{t('proposals')}</span>
                    {proposalCount > 0 && (
                      <span className="tabular-nums text-muted-foreground">{proposalCount}</span>
                    )}
                  </TabsTrigger>
                </TabsList>
                {view === 'pages' && nodes.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" aria-label={t('filter')} />}>
                      {t(`filters.${filter}`)}
                      <ChevronDown aria-hidden="true" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuRadioGroup
                        value={filter}
                        onValueChange={(value) => {
                          if (value === 'active' || value === 'draft' || value === 'archived')
                            setFilter(value);
                        }}
                      >
                        {(['active', 'draft', 'archived'] as const).map((value) => (
                          <DropdownMenuRadioItem key={value} value={value}>
                            {t(`filters.${value}`)}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            )}
            <TabsContent value="pages" className="min-w-0">
              {tree.isError ? (
                <LoadError retry={() => void tree.refetch()} />
              ) : tree.isPending ? (
                <Skeleton className="h-40" />
              ) : listing.length > 0 ? (
                <KnowledgeList nodes={listing} locations={locations} onOpen={open} />
              ) : nodes.length > 0 ? (
                <EmptyState icon={LibraryBig} title={t(`emptyFilter.${filter}`)} />
              ) : (
                <EmptyState
                  icon={LibraryBig}
                  title={t('emptyLibrary')}
                  description={t(canEdit ? 'emptyLibraryHint' : 'emptyReadOnlyHint')}
                >
                  {canEdit && (
                    <>
                      <Button onClick={(event) => create('page', undefined, event.currentTarget)}>
                        {t('newPage')}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={(event) =>
                          openAction({ type: 'import', kind: 'upload' }, event.currentTarget)
                        }
                      >
                        {t('upload')}
                      </Button>
                    </>
                  )}
                </EmptyState>
              )}
            </TabsContent>
            {canEdit && (
              <>
                <TabsContent value="sources" className="min-w-0">
                  {sources.isError ? (
                    <LoadError retry={() => void sources.refetch()} />
                  ) : sources.isPending ? (
                    <Skeleton className="m-4 h-40" />
                  ) : (
                    <KnowledgeSources
                      knowledge={knowledge}
                      sources={sources.data}
                      nodes={nodes}
                      selectedId={sourceId}
                      onOpen={open}
                      onUpload={(event) =>
                        openAction({ type: 'import', kind: 'upload' }, event.currentTarget)
                      }
                      onPaste={(event) => openAction({ type: 'import', kind: 'text' }, event.currentTarget)}
                    />
                  )}
                </TabsContent>
                <TabsContent value="proposals" className="min-w-0">
                  {proposals.isError ? (
                    <LoadError retry={() => void proposals.refetch()} />
                  ) : proposals.isPending ? (
                    <Skeleton className="m-4 h-40" />
                  ) : (
                    <KnowledgeProposals
                      knowledge={knowledge}
                      proposals={proposals.data}
                      byId={byId}
                      canPublish={canPublish}
                      onOpen={open}
                    />
                  )}
                </TabsContent>
              </>
            )}
          </Tabs>
        </>
      )}
      {action?.type === 'create' && (
        <CreateNodeDialog
          knowledge={knowledge}
          kind={action.kind}
          parent={action.parent}
          onClose={closeAction}
          onCreated={(node) => {
            closeAction(false);
            setFilter('active');
            setEditOnOpen(node.kind === 'page' ? node.id : null);
            navigate('pages', { page: node.id });
          }}
        />
      )}
      {action?.type === 'import' && (
        <ImportSourceDialog
          knowledge={knowledge}
          kind={action.kind}
          onClose={closeAction}
          onImported={(id) => {
            closeAction(false);
            navigate('sources', { source: id });
          }}
        />
      )}
      {action?.type === 'search' && (
        <KnowledgeSearch
          knowledge={knowledge}
          nodes={nodes}
          byId={byId}
          onOpen={(id) => {
            open(id);
            closeAction(selectedId === id);
          }}
          onClose={closeAction}
        />
      )}
    </main>
  );
}
