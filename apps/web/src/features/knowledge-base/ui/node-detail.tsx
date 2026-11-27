import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Archive,
  ChevronRight,
  Ellipsis,
  FileText,
  FolderInput,
  History,
  Pencil,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@workspace/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs';

import { ancestors, type Knowledge, orderNodes, useKnowledgeError } from '../model/knowledge';
import { MoveNodeDialog } from './knowledge-dialogs';
import { KnowledgeList } from './knowledge-list';
import { EmptyState, KnowledgeMarkdown, LoadError, NodeStatus } from './knowledge-ui';
import { PageEditor } from './page-editor';

import type { KnowledgeNode, KnowledgeRevision, KnowledgeSource } from '@/shared/api';
import { useConfirm } from '@/shared/ui/confirm-dialog';

export function NodeDetail({
  knowledge,
  node,
  nodes,
  byId,
  canEdit,
  canPublish,
  startEditing,
  source,
  onOpen,
  folderActions,
  onSources,
  onBlockingChange,
}: {
  knowledge: Knowledge;
  node: KnowledgeNode;
  nodes: KnowledgeNode[];
  byId: Map<string, KnowledgeNode>;
  canEdit: boolean;
  canPublish: boolean;
  startEditing: boolean;
  source?: KnowledgeSource;
  onOpen: (id: string) => void;
  folderActions?: ReactNode;
  onSources: () => void;
  onBlockingChange: (blocked: boolean) => void;
}) {
  const t = useTranslations('knowledge');
  const locale = useLocale();
  const format = useFormatter();
  const message = useKnowledgeError();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(startEditing);
  const [moving, setMoving] = useState(false);
  const [tab, setTab] = useState('content');
  const titleRef = useRef<HTMLHeadingElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!startEditing) titleRef.current?.focus();
  }, [node.id, startEditing]);
  const archived = node.status === 'archived';
  const writable = canEdit && !archived;
  const isPage = node.kind === 'page';
  const status = useMutation({
    mutationFn: (action: 'publish' | 'archive' | 'restore') => knowledge.api[action](node.id),
    onSuccess: (updated) => {
      knowledge.storeNode(updated);
      titleRef.current?.focus();
      toast.success(
        t(
          updated.status === 'published'
            ? 'published'
            : updated.status === 'archived'
              ? 'archived'
              : 'restored',
        ),
      );
    },
    onError: (error) => toast.error(message(error)),
  });
  const children = nodes.filter((child) => child.parentId === node.id && child.status !== 'archived');

  return (
    <section className="min-w-0">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <h1
              ref={titleRef}
              tabIndex={-1}
              className="text-2xl leading-tight font-semibold tracking-tight wrap-anywhere outline-none"
            >
              {node.title}
            </h1>
            {isPage || archived ? (
              <div className="flex flex-wrap items-center gap-2">
                <NodeStatus status={node.status} />
                <span className="text-xs text-muted-foreground">
                  {t('updated', { date: format.dateTime(new Date(node.updatedAt), { dateStyle: 'medium' }) })}
                </span>
              </div>
            ) : null}
          </div>
          {!editing && (
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              {!isPage && writable && folderActions}
              {writable && (
                <Button
                  variant="outline"
                  size="lg"
                  className="h-10 px-2.5 sm:px-4"
                  disabled={status.isPending}
                  onClick={() => {
                    setTab('content');
                    setEditing(true);
                  }}
                >
                  <Pencil aria-hidden="true" />
                  {t('edit')}
                </Button>
              )}
              {canPublish && isPage && node.status === 'draft' && (
                <Button
                  size="lg"
                  className="h-10 px-2.5 sm:px-4"
                  disabled={!node.body.trim() || status.isPending}
                  onClick={() => status.mutate('publish')}
                >
                  {t('publish')}
                </Button>
              )}
              {canPublish && archived && (
                <Button size="lg" disabled={status.isPending} onClick={() => status.mutate('restore')}>
                  <RotateCcw aria-hidden="true" />
                  {t('restore')}
                </Button>
              )}
              {(writable || (canPublish && !archived)) && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        ref={actionRef}
                        size="icon-lg"
                        variant="ghost"
                        aria-label={t('actions')}
                        disabled={status.isPending}
                      />
                    }
                  >
                    <Ellipsis aria-hidden="true" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-max whitespace-nowrap">
                    {writable && (
                      <DropdownMenuItem onClick={() => setMoving(true)}>
                        <FolderInput aria-hidden="true" />
                        {t('move')}
                      </DropdownMenuItem>
                    )}
                    {canPublish && !archived && (
                      <DropdownMenuItem
                        onClick={async () => {
                          if (
                            await confirm({
                              title: t('archive'),
                              description: t(isPage ? 'archiveHint' : 'archiveFolderHint'),
                              confirmLabel: t('archive'),
                              danger: false,
                            })
                          )
                            status.mutate('archive');
                        }}
                      >
                        <Archive aria-hidden="true" />
                        {t('archive')}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
        </div>
      </header>

      {editing && writable ? (
        <div className="py-6">
          <PageEditor
            knowledge={knowledge}
            node={node}
            canPublish={canPublish}
            onClose={() => {
              setEditing(false);
              titleRef.current?.focus();
            }}
            onBlockingChange={onBlockingChange}
          />
        </div>
      ) : isPage ? (
        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (typeof value === 'string') setTab(value);
          }}
          className="mt-5 gap-0"
        >
          <div>
            <TabsList aria-label={t('pageDetails')} className="max-w-full">
              <TabsTrigger value="content">{t('content')}</TabsTrigger>
              {canEdit && <TabsTrigger value="source">{t('sources')}</TabsTrigger>}
              {canEdit && <TabsTrigger value="history">{t('history')}</TabsTrigger>}
            </TabsList>
          </div>
          <TabsContent value="content" className="py-6">
            {node.status === 'draft' &&
              (canPublish && node.body.trim() ? (
                <p className="mb-5 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
                  {t('publishHint')}
                </p>
              ) : canPublish ? (
                <p className="mb-5 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
                  {t('publishEmptyHint')}
                </p>
              ) : null)}
            <KnowledgeMarkdown body={node.body} />
          </TabsContent>
          <TabsContent value="source" className="py-6">
            {source ? (
              <Button
                variant="outline"
                className="h-auto min-h-10 max-w-full justify-start text-left whitespace-normal"
                onClick={onSources}
              >
                <Upload aria-hidden="true" />
                <span className="min-w-0 wrap-anywhere">{source.title}</span>
              </Button>
            ) : (
              <EmptyState icon={FileText} title={t(node.sourceId ? 'sourceUnavailable' : 'noLinkedSource')} />
            )}
          </TabsContent>
          <TabsContent value="history" className="py-4">
            {tab === 'history' && <PageHistory knowledge={knowledge} node={node} canRestore={writable} />}
          </TabsContent>
        </Tabs>
      ) : (
        <div className="mt-6">
          {children.length > 0 ? (
            <KnowledgeList nodes={orderNodes(children, locale)} onOpen={onOpen} />
          ) : (
            <EmptyState
              icon={FileText}
              title={t('emptyFolder')}
              description={writable ? t('emptyFolderHint') : undefined}
            />
          )}
        </div>
      )}
      {moving && (
        <MoveNodeDialog
          knowledge={knowledge}
          node={node}
          nodes={nodes}
          onClose={() => {
            setMoving(false);
            window.requestAnimationFrame(() => actionRef.current?.focus());
          }}
          destinations={nodes
            .filter((folder) => folder.kind === 'folder' && folder.status !== 'archived')
            .flatMap((folder) => {
              const branch = ancestors(folder.id, byId);
              return branch.some((item) => item.id === node.id)
                ? []
                : [{ id: folder.id, label: branch.map((item) => item.title).join(' / ') }];
            })
            .sort((a, b) => a.label.localeCompare(b.label, locale))}
        />
      )}
    </section>
  );
}

function PageHistory({
  knowledge,
  node,
  canRestore,
}: {
  knowledge: Knowledge;
  node: KnowledgeNode;
  canRestore: boolean;
}) {
  const t = useTranslations('knowledge');
  const format = useFormatter();
  const message = useKnowledgeError();
  const confirm = useConfirm();
  const [view, setView] = useState<number | null>(null);
  const history = useQuery({
    queryKey: knowledge.keys.history(node.id),
    queryFn: ({ signal }) => knowledge.api.revisions(node.id, signal),
  });
  const restore = useMutation({
    mutationFn: (revision: number) => knowledge.api.restoreRevision(node.id, revision),
    onSuccess: (updated) => {
      knowledge.storeNode(updated);
      setView(null);
      toast.success(t('restored'));
    },
    onError: (error) => toast.error(message(error)),
  });
  if (history.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
    );
  if (history.isError) return <LoadError retry={() => void history.refetch()} />;
  if (!history.data.length) return <EmptyState icon={History} title={t('noHistory')} />;

  async function restoreVersion(version: KnowledgeRevision) {
    if (
      await confirm({
        title: t('restoreVersion'),
        description: t('restoreVersionHint'),
        confirmLabel: t('restore'),
        danger: false,
      })
    ) {
      restore.mutate(version.revision);
    }
  }

  return (
    <ul className="divide-y">
      {history.data.map((version, index) => (
        <li key={version.revision} className="py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="ghost"
              aria-expanded={view === version.revision}
              className="min-h-10 font-normal"
              onClick={() => setView(view === version.revision ? null : version.revision)}
            >
              <ChevronRight
                aria-hidden="true"
                className={view === version.revision ? 'rotate-90' : undefined}
              />
              {t('version', { number: version.revision })}
              <span className="text-xs text-muted-foreground">
                {format.dateTime(new Date(version.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            </Button>
            {canRestore && index > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={restore.isPending}
                onClick={() => void restoreVersion(version)}
              >
                {t('restoreVersion')}
              </Button>
            )}
          </div>
          {view === version.revision && (
            <div className="m-2 space-y-3 rounded-xl border p-4">
              <p className="font-medium">{version.title}</p>
              <KnowledgeMarkdown body={version.body} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
