'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Plus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import type { Workspace } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import { Spinner } from '@workspace/ui/components/spinner';

import { useProjects, useWorkspaces } from '@/entities/workspace';
import { Composer } from '@/features/manager-chat/ui/composer';
import { projectChat } from '@/shared/api';
import { useWorkStream } from '@/shared/api/use-work-stream';
import { useErrorMessage } from '@/shared/lib/api-error';

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

function Conversation({ account, project }: { account: Workspace; project: string }) {
  const t = useTranslations('managerChat');
  const tComposer = useTranslations('composer');
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const api = projectChat(account.id, project);
  const scope = ['chat', account.id, project];
  const partial = useWorkStream(account.id, project);
  const list = useQuery({ queryKey: [...scope, 'list'], queryFn: ({ signal }) => api.list(signal) });
  const [selected, setSelected] = useState<string>();
  const conversation = selected ?? list.data?.[0]?.id;
  const messages = useInfiniteQuery({
    queryKey: [...scope, 'messages', conversation],
    enabled: Boolean(conversation),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) => api.history(conversation!, signal, pageParam),
    getNextPageParam: (page) => (page.length >= 100 ? page[0]?.createdAt : undefined),
    refetchInterval: (query) =>
      query.state.data?.pages[0]?.some((m) => m.status === 'streaming') ? 5000 : false,
  });
  const create = useMutation({
    mutationFn: api.create,
    onSuccess: async (created) => {
      client.setQueryData<NonNullable<typeof list.data>>([...scope, 'list'], (rows = []) => [
        created,
        ...rows.filter((r) => r.id !== created.id),
      ]);
      setSelected(created.id);
      await list.refetch();
    },
  });
  const send = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => api.send(id, text),
    onSuccess: ({ message, reply }, { id }) => {
      client.setQueryData<typeof messages.data>([...scope, 'messages', id], (data) => {
        if (!data) return data;
        const [latest = [], ...older] = data.pages;
        const added = [message, reply].filter((row) => !latest.some((existing) => existing.id === row.id));
        return { ...data, pages: [[...latest, ...added], ...older] };
      });
    },
    onSettled: async (_data, _error, { id }) => {
      await Promise.all([client.invalidateQueries({ queryKey: [...scope, 'messages', id] }), list.refetch()]);
    },
  });
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const rows = messages.data?.pages.slice().reverse().flat() ?? [];
  const last = rows.at(-1);
  const tail = last && partial[last.id];
  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [last?.id, last?.text, tail, conversation]);
  const canWrite = account.role !== 'viewer';
  const busy = rows.some((m) => m.status === 'streaming');
  const changeConversation = (id: string) => {
    follow.current = true;
    send.reset();
    setSelected(id);
  };
  return (
    <>
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-3">
        {list.data?.length ? (
          <select
            aria-label={t('history')}
            className="min-w-0 max-w-full flex-1 truncate rounded-md border bg-background px-2 py-1.5 text-sm"
            value={conversation ?? ''}
            onChange={(event) => changeConversation(event.target.value)}
          >
            {list.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title ?? t('untitled')}
              </option>
            ))}
          </select>
        ) : (
          <span className="flex-1" />
        )}
        {canWrite && (
          <Button
            variant="outline"
            size="sm"
            disabled={create.isPending || list.isPending || send.isPending}
            onClick={() => create.mutate()}
          >
            <Plus />
            {t('new')}
          </Button>
        )}
      </div>
      <div
        ref={scroll}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          const box = e.currentTarget;
          follow.current = box.scrollHeight - box.clientHeight - box.scrollTop < 96;
        }}
      >
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-5 px-4 py-5">
          {(list.isPending || (conversation && messages.isPending)) && <Spinner className="mx-auto" />}
          {(list.isError || messages.isError) && (
            <Button
              variant="outline"
              onClick={() => {
                void list.refetch();
                if (conversation) void messages.refetch();
              }}
            >
              {t('retry')}
            </Button>
          )}
          {messages.hasNextPage && (
            <Button
              variant="ghost"
              disabled={messages.isFetchingNextPage}
              onClick={() => void messages.fetchNextPage()}
            >
              {t('older')}
            </Button>
          )}
          {list.isSuccess && (!conversation || messages.isSuccess) && !rows.length && (
            <div className="m-auto text-center text-muted-foreground">
              <MessageSquare className="mx-auto mb-3 size-8" />
              <p>{t(conversation ? 'empty' : 'start')}</p>
            </div>
          )}
          {rows.map((m) => {
            const liveText = partial[m.id];
            const text =
              m.status === 'streaming' && liveText && liveText.startsWith(m.text) ? liveText : m.text;
            return (
              <article
                key={m.id}
                className={
                  m.role === 'user'
                    ? 'max-w-[85%] self-end rounded-2xl bg-muted px-4 py-2.5'
                    : 'max-w-full self-start py-1'
                }
              >
                <p className="text-sm/6 wrap-anywhere whitespace-pre-wrap">{text}</p>
                {m.status === 'streaming' && (
                  <span role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Spinner />
                    {t('generating')}
                  </span>
                )}
                {m.status === 'failed' && (
                  <p role="status" className="text-xs text-destructive">
                    {t('failed')}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl space-y-2 px-4 pt-2 pb-5">
        {(create.error || send.error) && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(create.error ?? send.error)}
          </p>
        )}
        {!canWrite && <p className="text-sm text-muted-foreground">{tComposer('viewer')}</p>}
        {canWrite && conversation && (
          <Composer
            key={conversation}
            disabled={busy || !messages.isSuccess}
            sending={send.isPending}
            onSend={async (text) => {
              try {
                follow.current = true;
                await send.mutateAsync({ id: conversation, text });
                return true;
              } catch {
                return false;
              }
            }}
          />
        )}
      </div>
    </>
  );
}

function ProjectChat({ account }: { account: Workspace }) {
  const t = useTranslations('managerChat');
  const storage = `geniebox:project:${account.id}`;
  const projects = useProjects(account.id);
  const [choice, setChoice] = useState(() => sessionStorage.getItem(storage));
  const project = projects.data?.find((p) => p.id === choice) ?? projects.data?.[0];
  return (
    <>
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b px-12">
        <h1 className="font-semibold">{t('title')}</h1>
        {project && (
          <select
            aria-label={t('project')}
            className="ml-auto max-w-full truncate rounded-md border bg-background px-2 py-1 text-sm"
            value={project.id}
            onChange={(e) => {
              sessionStorage.setItem(storage, e.target.value);
              setChoice(e.target.value);
            }}
          >
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </header>
      {projects.isError ? (
        <Button className="m-auto" onClick={() => void projects.refetch()}>
          {t('retry')}
        </Button>
      ) : projects.isPending ? (
        <Spinner className="m-auto" />
      ) : project ? (
        <Conversation key={project.id} account={account} project={project.id} />
      ) : (
        <SetupLink project />
      )}
    </>
  );
}

export function ManagerChatScreen() {
  const directory = useWorkspaces();
  const t = useTranslations('managerChat');
  return (
    <main className="flex h-full flex-col">
      {directory.active ? (
        <ProjectChat key={directory.active.id} account={directory.active} />
      ) : directory.isPending ? (
        <Spinner className="m-auto" />
      ) : directory.isError ? (
        <Button className="m-auto" onClick={() => void directory.refetch()}>
          {t('retry')}
        </Button>
      ) : (
        <SetupLink />
      )}
    </main>
  );
}
