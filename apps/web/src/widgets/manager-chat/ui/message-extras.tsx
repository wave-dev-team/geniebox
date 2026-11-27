'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChartNoAxesColumn, Check, ClipboardList, ExternalLink, Scale } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { toast } from 'sonner';

import type { ChatAction, ChatCard } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import { Skeleton } from '@workspace/ui/components/skeleton';
import { Spinner } from '@workspace/ui/components/spinner';

import { projectChat } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';

function externalUrl(value: string | null) {
  if (!value) return;
  try {
    const url = new URL(value, typeof window === 'undefined' ? undefined : window.location.origin);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch {
    return;
  }
}

export function MessageActions({
  account,
  project,
  conversation,
  actions,
  disabled,
}: {
  account: string;
  project: string;
  conversation: string;
  actions: ChatAction[];
  disabled: boolean;
}) {
  const t = useTranslations('managerChat');
  const client = useQueryClient();
  const errorMessage = useErrorMessage();
  const api = projectChat(account, project);
  const press = useMutation({
    mutationFn: (id: string) => api.press(id),
    onSuccess: (result, id) => {
      const url = externalUrl(result.url);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      if (result.status === 'failed') toast.error(result.text);
      else if (actions.find((action) => action.id === id)?.kind !== 'reply') toast.success(result.text);
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () =>
      client.invalidateQueries({ queryKey: ['chat', account, project, 'messages', conversation] }),
  });
  const replied = actions.some(({ kind, status }) => kind === 'reply' && status === 'done');
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={t('actions')}>
      {actions.map((action) => {
        if (replied && action.kind === 'reply' && action.status !== 'done') return null;
        if (action.kind === 'link') {
          const url = externalUrl(action.url);
          return url ? (
            <Button
              key={action.id}
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<a href={url} target="_blank" rel="noopener noreferrer" />}
            >
              {action.label}
              <ExternalLink />
            </Button>
          ) : null;
        }
        if (action.status === 'done') {
          return (
            <span
              key={action.id}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-dashed px-3 text-sm text-muted-foreground"
            >
              <Check className="size-3.5" />
              {action.kind === 'reply' ? action.label : (action.result ?? action.label)}
            </span>
          );
        }
        const expired = action.status === 'expired';
        return (
          <div key={action.id} className="flex flex-col gap-1">
            <Button
              variant={action.kind === 'action' ? 'default' : 'outline'}
              size="sm"
              disabled={disabled || expired || press.isPending}
              className="whitespace-normal"
              title={expired ? t('actionExpired') : undefined}
              onClick={() => press.mutate(action.id)}
            >
              {press.isPending && press.variables === action.id && <Spinner />}
              {action.label}
            </Button>
            {action.result && <span className="text-xs text-muted-foreground">{action.result}</span>}
          </div>
        );
      })}
    </div>
  );
}

function CardFrame({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-card p-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <div className="grid min-w-0 flex-1 gap-1">{children}</div>
    </div>
  );
}

type CardProps = { account: string; project: string; card: ChatCard };

export function MessageCard(props: CardProps) {
  switch (props.card.type) {
    case 'chart':
      return <ChartCard {...props} />;
    case 'decision':
      return <DecisionCard {...props} />;
    case 'task':
      return <TaskCard {...props} />;
  }
}

function TaskCard({ account, project, card }: CardProps) {
  const t = useTranslations('managerChat');
  const query = useQuery({
    queryKey: ['chat-card', account, project, 'task', card.id],
    queryFn: ({ signal }) => projectChat(account, project).task(card.id, signal),
    refetchInterval: ({ state }) =>
      state.data && ['planned', 'running', 'waiting'].includes(state.data.status) ? 3000 : false,
  });
  return (
    <CardFrame icon={<ClipboardList className="size-4" />}>
      {query.isPending ? (
        <Skeleton className="h-10" />
      ) : query.data ? (
        <>
          <strong className="font-medium">{query.data.title}</strong>
          <span className="text-xs text-muted-foreground">{t(`cardTaskStatus.${query.data.status}`)}</span>
          {(query.data.progressText || query.data.summary) && (
            <span className="text-muted-foreground">{query.data.progressText || query.data.summary}</span>
          )}
          {query.data.progressPct !== null && query.data.status === 'running' && (
            <progress
              className="h-2 w-full accent-primary"
              max={100}
              value={query.data.progressPct}
              aria-label={t('cardTaskStatus.running')}
            />
          )}
          {query.data.result && <p className="wrap-anywhere whitespace-pre-wrap">{query.data.result}</p>}
        </>
      ) : (
        <span className="text-muted-foreground">{t('cardError')}</span>
      )}
    </CardFrame>
  );
}

function DecisionCard({ account, project, card }: CardProps) {
  const t = useTranslations('managerChat');
  const query = useQuery({
    queryKey: ['chat-card', account, project, 'decision', card.id],
    queryFn: ({ signal }) => projectChat(account, project).decision(card.id, signal),
  });
  return (
    <CardFrame icon={<Scale className="size-4" />}>
      {query.isPending ? (
        <Skeleton className="h-10" />
      ) : query.data ? (
        <>
          <strong className="font-medium">{query.data.title}</strong>
          {query.data.meta && <span className="text-muted-foreground">{query.data.meta}</span>}
          {(query.data.effect || query.data.cost) && (
            <span className="text-muted-foreground">
              {[query.data.effect, query.data.cost].filter(Boolean).join(' · ')}
            </span>
          )}
          {query.data.taskId && (
            <TaskCard account={account} project={project} card={{ id: query.data.taskId, type: 'task' }} />
          )}
        </>
      ) : (
        <span className="text-muted-foreground">{t('cardError')}</span>
      )}
    </CardFrame>
  );
}

function ChartCard({ account, project, card }: CardProps) {
  const t = useTranslations('managerChat');
  const format = useFormatter();
  const days = card.days ?? 30;
  const query = useQuery({
    queryKey: ['chat-card', account, project, 'chart', card.id, days],
    queryFn: ({ signal }) => projectChat(account, project).chart(card.id, days, signal),
  });
  const points = query.data?.points ?? [];
  const values = points.map(({ value }) => value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const graph = points
    .map(
      ({ value }, index) =>
        `${(100 * index) / Math.max(points.length - 1, 1)},${max === min ? 20 : 38 - (36 * (value - min)) / (max - min)}`,
    )
    .join(' ');
  return (
    <CardFrame icon={<ChartNoAxesColumn className="size-4" />}>
      <strong className="font-medium">{query.data?.title ?? t('cardChart')}</strong>
      {query.isPending ? (
        <Skeleton className="h-16" />
      ) : query.isError ? (
        <span className="text-muted-foreground">{t('cardError')}</span>
      ) : points.length ? (
        <>
          <span className="text-muted-foreground">
            {t('cardChartRange', { min: format.number(min), max: format.number(max) })}
          </span>
          {points.length > 1 && (
            <svg
              className="h-20 w-full text-primary"
              viewBox="0 0 100 40"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polyline
                points={graph}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
        </>
      ) : (
        <span className="text-muted-foreground">{t('cardChartEmpty')}</span>
      )}
    </CardFrame>
  );
}
