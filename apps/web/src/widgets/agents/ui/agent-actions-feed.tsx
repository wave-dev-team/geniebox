'use client';

import { CheckCircle2, Lightbulb, ListTodo, Shield, StickyNote, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import type { AgentActionItem, AgentActionPage, AgentActionType } from '@workspace/types';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { Skeleton } from '@workspace/ui/components/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs';
import { cn } from '@workspace/ui/lib/utils';

import { routes } from '@/shared/config/routes';

const ACTION_ICONS: Record<AgentActionType, typeof Wrench> = {
  tool: Wrench,
  task: ListTodo,
  decision: CheckCircle2,
  insight: Lightbulb,
  note: StickyNote,
  admin: Shield,
};

function dateGroupKey(iso: string, todayLabel: string, yesterdayLabel: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startOfToday.getTime() - startOfDate.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return todayLabel;
  if (diffDays === 1) return yesterdayLabel;
  return date.toLocaleDateString();
}

function actionLink(item: AgentActionItem, projectId?: string): string | null {
  if (item.type === 'task' && item.targetId) return routes.tasks(item.targetId);
  if (item.type === 'decision') {
    if (item.taskId) return routes.tasks(item.taskId);
    if (projectId) return routes.chat(projectId);
  }
  if (item.type === 'insight' && projectId) return routes.chat(projectId);
  return null;
}

export function AgentActionsFeed({
  pages,
  isLoading,
  hasNextPage,
  isFetchingNextPage,
  period,
  projectId,
  visible,
  onPeriodChange,
  onLoadMore,
}: {
  pages?: AgentActionPage[];
  isLoading: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  period: '7d' | '30d';
  projectId?: string;
  visible: boolean;
  onPeriodChange: (period: '7d' | '30d') => void;
  onLoadMore: () => void;
}) {
  const t = useTranslations('agentsSection');
  const allActions = pages?.flatMap((p) => p.items) ?? [];
  const groupedActions = new Map<string, AgentActionItem[]>();

  for (const item of allActions) {
    const label = dateGroupKey(item.at, t('groups.today'), t('groups.yesterday'));
    const list = groupedActions.get(label) ?? [];
    list.push(item);
    groupedActions.set(label, list);
  }

  return (
    <div className={cn('space-y-4', !visible && 'hidden lg:block')}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('detailTabs.actions')}</h2>
        <Tabs value={period} onValueChange={(value) => onPeriodChange(value as '7d' | '30d')}>
          <TabsList>
            {(['7d', '30d'] as const).map((p) => (
              <TabsTrigger key={p} value={p} className="text-xs">
                {t(`periods.${p}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && allActions.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t('actionsEmpty')}
        </div>
      )}

      {Array.from(groupedActions.entries()).map(([group, items]) => (
        <div key={group} className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{group}</p>
          <div className="space-y-2">
            {items.map((item) => {
              const Icon = ACTION_ICONS[item.type] ?? Wrench;
              const href = actionLink(item, projectId);
              const timeStr = new Date(item.at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });
              return (
                <div key={item.id} className="rounded-xl border bg-card p-3.5 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {href ? (
                            <Link href={href} className="font-medium hover:underline">
                              {item.title}
                            </Link>
                          ) : (
                            <span className="font-medium">{item.title}</span>
                          )}
                          <Badge variant="outline" className="text-[11px]">
                            {item.status}
                          </Badge>
                        </div>
                        {item.details && (
                          <p className="mt-0.5 break-words text-xs text-muted-foreground">{item.details}</p>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{timeStr}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={isFetchingNextPage}
          onClick={onLoadMore}
        >
          {t('loadMore')}
        </Button>
      )}
    </div>
  );
}
