'use client';

import { useInfiniteQuery, useQueries } from '@tanstack/react-query';
import { Bot, Maximize2, MessageSquare, WandSparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useLayoutEffect, useRef } from 'react';

import type { ChatRequest, Workspace } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import { Marker, MarkerContent, MarkerIcon } from '@workspace/ui/components/marker';
import { Skeleton } from '@workspace/ui/components/skeleton';
import { Spinner } from '@workspace/ui/components/spinner';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@workspace/ui/components/trace';
import { cn } from '@workspace/ui/lib/utils';

import { MessageActions, MessageCard } from './message-extras';
import { StreamingText } from './streaming-text';

import { useMyProjects } from '@/entities/project';
import { useProjectAgents } from '@/entities/project/operations';
import { preferredProject, useProjects, useWorkspaces } from '@/entities/workspace';
import {
  chatSuggestions,
  usePersonalManagerConversation,
  useSendManagerMessage,
} from '@/features/manager-chat/model/chat';
import { Composer } from '@/features/manager-chat/ui/composer';
import { knowledgeApi, projectChat } from '@/shared/api';
import { useWorkStream } from '@/shared/api/use-work-stream';
import { routes } from '@/shared/config/routes';
import { useErrorMessage } from '@/shared/lib/api-error';
import { OptionSelect } from '@/shared/ui/option-select';

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function SetupLink({ project }: { project?: boolean }) {
  const t = useTranslations('workspace');
  return (
    <div className="m-auto flex max-w-sm flex-col items-center gap-4 p-6 text-center">
      <MessageSquare className="size-8 text-muted-foreground" />
      <p>{t(project ? 'noProjects' : 'noAccounts')}</p>
      <Link href="/settings" className="text-sm font-medium underline underline-offset-4">
        {t('settings')}
      </Link>
    </div>
  );
}

type WorkMessageItem = {
  id: string;
  agentId: string | null;
  status: string;
  text: string;
  cards: Parameters<typeof MessageCard>[0]['card'][];
  actions: Parameters<typeof MessageActions>[0]['actions'];
};

function WorkTraceBlock({
  messages,
  agents,
  partial,
  account,
  project,
  conversation,
  canWrite,
  busy,
  sending,
}: {
  messages: WorkMessageItem[];
  agents: Array<{ id: string; displayName: string; kind: string }>;
  partial: Record<string, string | undefined>;
  account: string;
  project: string;
  conversation: string | undefined;
  canWrite: boolean;
  busy: boolean;
  sending: boolean;
}) {
  const t = useTranslations('managerChat');
  const taskIds = Array.from(
    new Set(messages.flatMap((m) => m.cards.filter((c) => c.type === 'task').map((c) => c.id))),
  );
  const taskQueries = useQueries({
    queries: taskIds.map((taskId) => ({
      queryKey: ['chat-card', account, project, 'task', taskId],
      queryFn: ({ signal }: { signal: AbortSignal }) => projectChat(account, project).task(taskId, signal),
      refetchInterval: (query: { state: { data?: { status?: string } } }) =>
        query.state.data?.status && ['planned', 'running', 'waiting'].includes(query.state.data.status)
          ? 3000
          : false,
    })),
  });
  const streaming = messages.some((m) => m.status === 'streaming');
  const taskRunning = taskQueries.some((q) => q.data?.status === 'planned' || q.data?.status === 'running');
  const inProgress = streaming || taskRunning;
  const surfaceCards = messages.flatMap((m) =>
    m.cards.filter((c) => c.type === 'decision' || c.type === 'chart'),
  );
  const surfaceActions = messages.flatMap((m) => m.actions);

  return (
    <div className="flex flex-col gap-3">
      <TraceCollapsible defaultOpen={false}>
        <Marker variant="border">
          <MarkerIcon>
            {inProgress ? (
              <Spinner className="size-3" />
            ) : (
              <span className="size-2 rounded-full bg-emerald-500" />
            )}
          </MarkerIcon>
          <MarkerContent>
            {inProgress ? 'Анализирую данные…' : `Выполнено · ${messages.length}`}
          </MarkerContent>
          <TraceCollapsibleTrigger className="ml-auto">Детали</TraceCollapsibleTrigger>
        </Marker>
        <TraceCollapsibleContent>
          <Trace>
            {messages.map((message) => {
              const liveText = partial[message.id];
              const isStreaming = message.status === 'streaming';
              const value = isStreaming && liveText?.startsWith(message.text) ? liveText : message.text;
              const author = agents.find(({ id }) => id === message.agentId);
              const taskCards = message.cards.filter((c) => c.type === 'task');
              return (
                <TraceLine key={message.id}>
                  <TraceIcon>
                    {author?.kind === 'agent' ? (
                      <Bot className="size-3.5" />
                    ) : (
                      <WandSparkles className="size-3.5" />
                    )}
                  </TraceIcon>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <TraceTitle className="font-medium text-foreground/80">
                      {author?.displayName ?? t('manager')}
                    </TraceTitle>
                    {(value || isStreaming) && (
                      <StreamingText
                        text={value}
                        streaming={isStreaming}
                        waiting={t('generating')}
                        className={cn(
                          'text-xs leading-relaxed wrap-anywhere whitespace-pre-wrap text-muted-foreground',
                          message.status === 'failed' && 'text-destructive',
                        )}
                      />
                    )}
                    {taskCards.map((card) => (
                      <MessageCard
                        key={`${card.type}-${card.id}`}
                        account={account}
                        project={project}
                        card={card}
                      />
                    ))}
                  </div>
                </TraceLine>
              );
            })}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
      {surfaceCards.map((card) => (
        <MessageCard key={`${card.type}-${card.id}`} account={account} project={project} card={card} />
      ))}
      {conversation && surfaceActions.length > 0 && (
        <MessageActions
          account={account}
          project={project}
          conversation={conversation}
          actions={surfaceActions}
          disabled={!canWrite || busy || sending}
        />
      )}
    </div>
  );
}

function Conversation({
  account,
  project,
  panel,
  home,
  closePanel,
}: {
  account: Workspace;
  project: string;
  panel: boolean;
  home: boolean;
  closePanel?: () => void;
}) {
  const t = useTranslations('managerChat');
  const tComposer = useTranslations('composer');
  const tHome = useTranslations('home');
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const projectRef = { accountId: account.id, id: project };
  const agents = useProjectAgents(projectRef);
  const manager = agents.data?.find(({ kind }) => kind === 'manager');
  const team = agents.data?.filter(({ kind }) => kind === 'agent') ?? [];
  const api = projectChat(account.id, project);
  const scope = ['chat', account.id, project];
  const partial = useWorkStream(account.id, project);
  const personal = usePersonalManagerConversation(projectRef);
  const conversation = personal.data?.id;
  const messages = useInfiniteQuery({
    queryKey: [...scope, 'messages', conversation],
    enabled: Boolean(conversation),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) => api.history(conversation!, signal, pageParam),
    getNextPageParam: (page) => (page.length >= 100 ? page[0]?.id : undefined),
    refetchInterval: (query) =>
      query.state.data?.pages[0]?.some((m) => m.status === 'streaming') ? 3000 : false,
  });
  const send = useSendManagerMessage(projectRef);
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const rows = messages.data?.pages.slice().reverse().flat() ?? [];
  const canWrite = account.role !== 'viewer';

  useLayoutEffect(() => {
    const viewport = scroll.current;
    const inner = content.current;
    if (!viewport || !inner) return;
    const scrollToBottom = () => {
      if (follow.current) viewport.scrollTop = viewport.scrollHeight;
    };
    scrollToBottom();
    const observer = new ResizeObserver(scrollToBottom);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [conversation]);

  const busy = rows.some((m) => m.status === 'streaming');
  const loading = agents.isPending || personal.isPending || (Boolean(conversation) && messages.isPending);
  const loadError = agents.isError || personal.isError || (messages.isError && !rows.length);
  const landing = home && !loading && !loadError && !rows.length && Boolean(manager);
  const width = panel ? 'px-4' : 'max-w-180 px-6';
  const suggestions = chatSuggestions.map(({ key, icon: Icon }) => (
    <Button
      key={key}
      variant="outline"
      className={cn('whitespace-normal', !landing && 'justify-start')}
      disabled={send.isPending}
      onClick={() => void submit({ text: tHome(`suggestions.${key}`), mode: 'approve_all' })}
    >
      <Icon />
      {tHome(`suggestions.${key}`)}
    </Button>
  ));

  const submit = async (request: ChatRequest) => {
    if (!manager || busy || send.isPending) return false;
    try {
      follow.current = true;
      await send.mutateAsync({ conversation, request });
      return true;
    } catch {
      return false;
    }
  };

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', landing && 'justify-center gap-6 py-12')}>
      {landing && <h1 className="px-6 text-center text-3xl font-medium tracking-tight">{tHome('title')}</h1>}
      {!panel && !landing && <h1 className="sr-only">{t('personalConversation')}</h1>}
      {panel && (
        <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
          <WandSparkles className="size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-medium">{manager?.displayName ?? t('manager')}</h2>
            <p className="truncate text-xs text-muted-foreground">{t('managerRole')}</p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('expand')}
            aria-label={t('expand')}
            onClick={() => {
              closePanel?.();
              router.push(routes.chat(project));
            }}
          >
            <Maximize2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('close')}
            aria-label={t('close')}
            onClick={closePanel}
          >
            <X />
          </Button>
        </header>
      )}
      <div
        ref={scroll}
        className={cn('min-h-0 flex-1 overflow-y-auto', landing && 'hidden')}
        onScroll={(event) => {
          const box = event.currentTarget;
          follow.current = box.scrollHeight - box.clientHeight - box.scrollTop < 48;
        }}
      >
        <div
          ref={content}
          className={cn('mx-auto flex w-full flex-col gap-5 py-6', width)}
          role="log"
          aria-live="off"
          aria-label={t('history')}
        >
          {loading && (
            <>
              <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
              <Skeleton className="h-20 rounded-xl" />
            </>
          )}
          {loadError && (
            <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
              <p>{t('loadError')}</p>
              <Button
                variant="outline"
                onClick={() => {
                  if (agents.isError) void agents.refetch();
                  if (personal.isError) void personal.refetch();
                  if (conversation && messages.isError) void messages.refetch();
                }}
              >
                {t('retry')}
              </Button>
            </div>
          )}
          {messages.hasNextPage && (
            <Button
              variant="ghost"
              disabled={messages.isFetchingNextPage}
              onClick={() => {
                follow.current = false;
                const viewport = scroll.current;
                const previousHeight = viewport?.scrollHeight;
                void messages.fetchNextPage().then(() =>
                  requestAnimationFrame(() => {
                    if (viewport && previousHeight !== undefined && scroll.current === viewport) {
                      viewport.scrollTop += viewport.scrollHeight - previousHeight;
                    }
                  }),
                );
              }}
            >
              {t('older')}
            </Button>
          )}
          {!loading && !loadError && !rows.length && (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <h2 className="font-semibold">{manager ? t('personalConversation') : t('manager')}</h2>
              <p className="max-w-80 text-sm text-muted-foreground">
                {manager ? t('empty') : t('noManager')}
              </p>
              {manager && canWrite && !landing && (
                <div className="flex w-full flex-col gap-2">{suggestions}</div>
              )}
            </div>
          )}
          {(() => {
            const isInternal = (msg: (typeof rows)[number]) => {
              if (msg.role === 'user' || msg.notificationKind) return false;
              const author = agents.data?.find(({ id }) => id === msg.agentId);
              if (author?.kind === 'agent') return true;
              const hasTaskCard = msg.cards.some((c) => c.type === 'task');
              const hasBusinessCard = msg.cards.some((c) => c.type === 'decision' || c.type === 'chart');
              const hasPendingAction = msg.actions.some((a) => a.status !== 'done' && a.status !== 'expired');
              return hasTaskCard && !hasBusinessCard && !hasPendingAction;
            };
            const grouped: Array<
              | { kind: 'single'; message: (typeof rows)[number] }
              | { kind: 'trace'; messages: (typeof rows)[number][] }
            > = [];
            for (const msg of rows) {
              if (isInternal(msg)) {
                const last = grouped[grouped.length - 1];
                if (last?.kind === 'trace') last.messages.push(msg);
                else grouped.push({ kind: 'trace', messages: [msg] });
              } else {
                grouped.push({ kind: 'single', message: msg });
              }
            }
            return grouped.map((item) => {
              if (item.kind === 'trace') {
                return (
                  <WorkTraceBlock
                    key={item.messages[0]!.id}
                    messages={item.messages}
                    agents={agents.data ?? []}
                    partial={partial}
                    account={account.id}
                    project={project}
                    conversation={conversation}
                    canWrite={canWrite}
                    busy={busy}
                    sending={send.isPending}
                  />
                );
              }
              const message = item.message;
              if (message.role === 'user') {
                return (
                  <p
                    key={message.id}
                    className="ml-auto max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-[15px] wrap-anywhere whitespace-pre-wrap"
                  >
                    {message.text}
                  </p>
                );
              }
              if (message.notificationKind) {
                return (
                  <article key={message.id} className="grid gap-2 rounded-xl border bg-muted/40 px-4 py-3">
                    <p className="text-xs font-medium text-muted-foreground">{t('projectNotice')}</p>
                    <p className="text-sm font-medium">{t(`notices.${message.notificationKind}`)}</p>
                    {message.cards.map((card) => (
                      <MessageCard key={card.id} account={account.id} project={project} card={card} />
                    ))}
                  </article>
                );
              }
              const liveText = partial[message.id];
              const streaming = message.status === 'streaming';
              const value = streaming && liveText?.startsWith(message.text) ? liveText : message.text;
              const author = agents.data?.find(({ id }) => id === message.agentId);
              const visibleCards = message.cards.filter((card) => card.type !== 'task');
              return (
                <article key={message.id} className="flex gap-3">
                  <span
                    className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border"
                    title={author?.displayName ?? t('manager')}
                  >
                    <WandSparkles className="size-3.5" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    {(value || streaming) && (
                      <StreamingText
                        text={value}
                        streaming={streaming}
                        waiting={t('generating')}
                        className={cn(
                          'text-[15px] leading-relaxed wrap-anywhere whitespace-pre-wrap',
                          message.status === 'failed' && 'text-muted-foreground',
                        )}
                      />
                    )}
                    {message.status === 'failed' && (
                      <p role="status" className="text-xs text-destructive">
                        {t('failed')}
                      </p>
                    )}
                    {visibleCards.map((card) => (
                      <MessageCard
                        key={`${card.type}-${card.id}`}
                        account={account.id}
                        project={project}
                        card={card}
                      />
                    ))}
                    {conversation && message.actions.length > 0 && (
                      <MessageActions
                        account={account.id}
                        project={project}
                        conversation={conversation}
                        actions={message.actions}
                        disabled={!canWrite || busy || send.isPending}
                      />
                    )}
                  </div>
                </article>
              );
            });
          })()}
        </div>
      </div>
      <div className={cn('mx-auto w-full space-y-2', !landing && 'pb-4', width)}>
        {send.error && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(send.error)}
          </p>
        )}
        {canWrite ? (
          <Composer
            home={landing}
            agents={team}
            disabled={!manager || loading || loadError}
            sending={send.isPending || busy}
            onAttachFile={async (file) => {
              const contentBase64 = await fileToBase64(file);
              await knowledgeApi(account.id, project).createSource({
                kind: 'upload',
                filename: file.name,
                contentBase64,
              });
              return { name: file.name };
            }}
            onSend={submit}
          />
        ) : (
          <p className="rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            {tComposer('viewer')}
          </p>
        )}
      </div>
      {landing && canWrite && (
        <div className="mx-auto flex max-w-180 flex-wrap justify-center gap-2 px-6">{suggestions}</div>
      )}
    </div>
  );
}

function ProjectChat({
  account,
  home,
  closePanel,
}: {
  account: Workspace;
  home: boolean;
  closePanel?: () => void;
}) {
  const t = useTranslations('managerChat');
  const projects = useProjects(account.id);
  const router = useRouter();
  const params = useSearchParams();
  const selected = closePanel || home ? undefined : params.get('project');
  const project = selected
    ? projects.data?.find(({ id }) => id === selected)
    : preferredProject(projects.data, account.id);

  if (projects.isError) {
    return (
      <Button className="m-auto" onClick={() => void projects.refetch()}>
        {t('retry')}
      </Button>
    );
  }
  if (projects.isPending) return <Spinner className="m-auto" />;
  if (!project) return selected ? <ChatUnavailable /> : <SetupLink project />;
  return (
    <>
      {!closePanel && !home && projects.data.length > 1 && (
        <div className="flex justify-end px-4 pt-2">
          <OptionSelect
            ariaLabel={t('project')}
            options={projects.data.map(({ id }) => id)}
            value={project.id}
            label={(id) => projects.data.find((item) => item.id === id)?.name ?? id}
            onChange={(id) => {
              sessionStorage.setItem(`geniebox:project:${account.id}`, id);
              router.push(routes.chat(id));
            }}
          />
        </div>
      )}
      <Conversation
        key={project.id}
        account={account}
        project={project.id}
        panel={Boolean(closePanel)}
        home={home}
        closePanel={closePanel}
      />
    </>
  );
}

function ChatUnavailable() {
  const t = useTranslations('managerChat');
  return (
    <div className="m-auto flex max-w-sm flex-col items-center gap-4 p-6 text-center">
      <p role="status">{t('projectUnavailable')}</p>
      <Button variant="outline" nativeButton={false} render={<Link href={routes.chat()} />}>
        {t('history')}
      </Button>
    </div>
  );
}

export function ManagerChatScreen({ closePanel, home = false }: { closePanel?: () => void; home?: boolean }) {
  const directory = useWorkspaces();
  const projects = useMyProjects();
  const params = useSearchParams();
  const t = useTranslations('managerChat');
  const project = closePanel || home ? null : params.get('project');
  const accountId = projects.data?.find(
    ({ id, accountBlocked }) => id === project && !accountBlocked,
  )?.accountId;
  const account = project ? directory.data?.workspaces.find(({ id }) => id === accountId) : directory.active;
  const loading = directory.isPending || Boolean(project && projects.isPending);
  const { select } = directory;

  useEffect(() => {
    if (account && project && account.id !== directory.active?.id) select(account.id);
  }, [account, directory.active?.id, project, select]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {loading ? (
        <Spinner className="m-auto" />
      ) : directory.isError || (project && projects.isError) ? (
        <Button
          className="m-auto"
          onClick={() => {
            if (directory.isError) void directory.refetch();
            if (project && projects.isError) void projects.refetch();
          }}
        >
          {t('retry')}
        </Button>
      ) : account ? (
        <ProjectChat key={account.id} account={account} home={home} closePanel={closePanel} />
      ) : project ? (
        <ChatUnavailable />
      ) : (
        <SetupLink />
      )}
    </div>
  );
}
