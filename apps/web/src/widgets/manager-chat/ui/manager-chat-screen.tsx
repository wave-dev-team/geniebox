'use client';

import { Bot } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useLayoutEffect, useRef } from 'react';

import { Button } from '@workspace/ui/components/button';
import { Spinner } from '@workspace/ui/components/spinner';

import { useManagerChat } from '@/features/manager-chat/model/use-manager-chat';
import { Composer } from '@/features/manager-chat/ui/composer';
import { routes } from '@/shared/config/routes';

export function ManagerChatScreen() {
  const t = useTranslations('managerChat');
  const chat = useManagerChat();
  const scrollBox = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const latest = chat.turns.at(-1);

  useLayoutEffect(() => {
    const box = scrollBox.current;
    if (box && follow.current) box.scrollTop = box.scrollHeight;
  }, [latest?.id, latest?.answer, latest?.status, latest?.tasks.length]);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b px-12 text-sm font-semibold md:px-12">
        <Bot className="size-4 text-muted-foreground" aria-hidden="true" />
        <h1>{t('title')}</h1>
      </header>
      <div
        ref={scrollBox}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => {
          const box = event.currentTarget;
          follow.current = box.scrollHeight - box.clientHeight - box.scrollTop < 96;
        }}
      >
        <div className="mx-auto flex min-h-full w-full max-w-180 flex-col gap-7 px-4 py-6 sm:px-6">
          {chat.history.isPending && <Spinner className="mx-auto mt-6 text-muted-foreground" />}
          {chat.history.isError && (
            <div className="flex flex-col items-center gap-2">
              <p role="alert" className="text-sm text-muted-foreground">
                {t('loadError')}
              </p>
              <Button variant="outline" size="sm" onClick={() => void chat.history.refetch()}>
                {t('retry')}
              </Button>
            </div>
          )}
          {chat.loadOlder && (
            <div className="self-center text-center">
              <Button size="sm" variant="ghost" disabled={chat.loadingOlder} onClick={chat.loadOlder}>
                {chat.loadingOlder && <Spinner />}
                {t('older')}
              </Button>
              {chat.olderError && (
                <p role="alert" className="text-sm text-muted-foreground">
                  {t('loadError')}
                </p>
              )}
            </div>
          )}
          {chat.history.isSuccess && !latest && (
            <div className="m-auto max-w-sm text-center">
              <Bot className="mx-auto mb-3 size-7 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
            </div>
          )}
          {chat.turns.map((turn) => (
            <article key={turn.id} className="flex flex-col gap-5">
              <div className="max-w-[88%] self-end rounded-2xl bg-muted px-4 py-2.5 text-sm/6 wrap-anywhere whitespace-pre-wrap">
                <span className="sr-only">{t('you')}</span>
                <span>{turn.message}</span>
              </div>
              {turn.tasks.length > 0 && (
                <ul aria-label={t('tasks')} className="space-y-2">
                  {turn.tasks.map((task) => (
                    <li key={task.agentId} className="rounded-xl border px-3 py-2 text-sm">
                      {task.result ? (
                        <details>
                          <summary className="cursor-pointer">
                            {task.agentName} · {t(`taskStatus.${task.status}`)}
                          </summary>
                          <p className="pt-2 wrap-anywhere whitespace-pre-wrap text-muted-foreground">
                            {task.result}
                          </p>
                        </details>
                      ) : (
                        <div className="flex items-center gap-2">
                          {(task.status === 'running' || task.status === 'pending') && <Spinner />}
                          <span>
                            {task.agentName} · {t(`taskStatus.${task.status}`)}
                          </span>
                        </div>
                      )}
                      <Link
                        href={routes.tasks(task.id)}
                        className="mt-1 inline-block text-xs text-muted-foreground underline-offset-4 hover:underline"
                      >
                        {t('openTask')}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <div className="min-w-0">
                <span className="sr-only">{t('title')}</span>
                {turn.answer && <p className="text-sm/6 wrap-anywhere whitespace-pre-wrap">{turn.answer}</p>}
                {turn.status === 'pending' && (
                  <p role="status" className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner />
                    {t(turn.answer ? 'generating' : turn.tasks.length ? 'working' : 'queued')}
                  </p>
                )}
                {turn.status === 'failed' && (
                  <p role="status" className="mt-1 text-sm text-muted-foreground">
                    {t('failed')}
                  </p>
                )}
                {turn.status === 'limited' && (
                  <p role="status" className="text-sm text-muted-foreground">
                    {t('limited')}
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-180 shrink-0 flex-col gap-2 px-4 pt-2 pb-4 sm:px-6">
        {chat.history.data && !chat.history.data.enabled && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('unavailable')}
          </p>
        )}
        {chat.sendError && (
          <p role="alert" className="text-sm text-destructive">
            {t(chat.sendError)}
          </p>
        )}
        <Composer
          disabled={!chat.history.data?.enabled || chat.pending}
          sending={chat.sending}
          onSend={(message) => {
            follow.current = true;
            return chat.send(message);
          }}
        />
      </div>
    </section>
  );
}
