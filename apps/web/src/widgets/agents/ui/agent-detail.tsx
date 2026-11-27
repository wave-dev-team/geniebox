'use client';

import {
  ArrowLeft,
  CheckCircle2,
  Lightbulb,
  ListTodo,
  Lock,
  MessageSquare,
  Shield,
  StickyNote,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { AgentActionItem, AgentActionType } from '@workspace/types';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { Skeleton } from '@workspace/ui/components/skeleton';
import { Switch } from '@workspace/ui/components/switch';
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs';
import { cn } from '@workspace/ui/lib/utils';

import { useAgent, useAgentActions, useAgentStats, useToggleAgent } from '@/entities/agent/model/hooks';
import { AgentIcon } from '@/entities/agent/ui/agent-icon';
import { useActiveProject } from '@/entities/project/use-active-project';
import { ApiError } from '@/shared/api';
import { routes } from '@/shared/config/routes';
import { SectionLayout } from '@/widgets/section-layout';

const BUILTIN_SKILLS = ['surveys', 'promo', 'ab', 'digest'] as const;

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

export function AgentDetail({ agentId }: { agentId: string }) {
  const t = useTranslations('agentsSection');
  const tCommon = useTranslations('common');
  const { project, projectRef, isLoading: projectLoading, canAdmin } = useActiveProject();
  const agentQuery = useAgent(projectRef, agentId);
  const statsQuery = useAgentStats(projectRef, agentId);
  const toggle = useToggleAgent(projectRef);

  const [period, setPeriod] = useState<'7d' | '30d'>('7d');
  const [mobileTab, setMobileTab] = useState<'actions' | 'about'>('actions');
  const actionsQuery = useAgentActions(projectRef, agentId, period);

  const agent = agentQuery.data;
  const isNotFound = agentQuery.error instanceof ApiError && agentQuery.error.status === 404;

  if (projectLoading || agentQuery.isLoading) {
    return (
      <SectionLayout title={t('title')} nav={[]}>
        <div className="space-y-4">
          <Skeleton className="h-24 rounded-xl" />
          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <Skeleton className="h-80 rounded-xl" />
            <Skeleton className="h-80 rounded-xl" />
          </div>
        </div>
      </SectionLayout>
    );
  }

  if (isNotFound) {
    return (
      <SectionLayout title={t('title')} nav={[]}>
        <div className="flex flex-col items-start gap-3 rounded-xl border p-6">
          <p className="text-sm font-medium">{t('notFound')}</p>
          <Button nativeButton={false} render={<Link href={routes.agents()} />} size="sm" variant="outline">
            <ArrowLeft className="mr-2 size-4" />
            {t('backToList')}
          </Button>
        </div>
      </SectionLayout>
    );
  }

  if (agentQuery.isError || !agent) {
    return (
      <SectionLayout title={t('title')} nav={[]}>
        <div className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6">
          <p className="text-sm font-medium">{t('loadError')}</p>
          <Button size="sm" variant="outline" onClick={() => void agentQuery.refetch()}>
            {tCommon('retry')}
          </Button>
        </div>
      </SectionLayout>
    );
  }

  const isActive = agent.status !== 'paused';
  const allActions = actionsQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const groupedActions = new Map<string, AgentActionItem[]>();
  for (const item of allActions) {
    const label = dateGroupKey(item.at, t('groups.today'), t('groups.yesterday'));
    const list = groupedActions.get(label) ?? [];
    list.push(item);
    groupedActions.set(label, list);
  }

  return (
    <SectionLayout
      title={agent.displayName}
      subtitle={agent.roleText ?? undefined}
      nav={[]}
      action={
        <div className="flex items-center gap-2">
          <Button nativeButton={false} render={<Link href={routes.agents()} />} size="sm" variant="ghost">
            <ArrowLeft className="mr-1.5 size-4" />
            {t('backToList')}
          </Button>
          {project && (
            <Button
              nativeButton={false}
              render={<Link href={routes.chat(project.id)} />}
              size="sm"
              variant="outline"
            >
              <MessageSquare className="mr-1.5 size-4" />
              {t('askManager')}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        {/* Sticky header on mobile */}
        <div className="sticky top-0 z-10 -mx-1 rounded-xl border bg-card/95 p-4 backdrop-blur md:static md:mx-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <AgentIcon icon={agent.icon} kind={agent.kind} size="lg" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold">{agent.displayName}</span>
                  <Badge variant={isActive ? 'default' : 'secondary'}>
                    {isActive ? t('status.active') : t('status.paused')}
                  </Badge>
                </div>
                {agent.connections.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {agent.connections.map((conn) => (
                      <Badge key={conn.connectionId} variant="outline" className="text-[11px]">
                        {conn.providerKey}: {conn.status}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {agent.kind !== 'manager' && (
              <Switch
                checked={isActive}
                disabled={!canAdmin || toggle.isPending}
                aria-label={t('toggleLabel', { name: agent.displayName })}
                onCheckedChange={(next) => toggle.mutate({ agentId: agent.id, pause: !next })}
              />
            )}
          </div>
        </div>

        {!isActive && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            {t('pausedBanner')}
          </div>
        )}

        {/* Stats (no money fields) */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border bg-card p-3.5">
            <p className="text-xs text-muted-foreground">{t('stats.actionsWeek')}</p>
            <p className="mt-1 text-xl font-semibold">
              {statsQuery.data?.actionsWeek ?? agent.summary.actionsWeek}
            </p>
          </div>
          <div className="rounded-xl border bg-card p-3.5">
            <p className="text-xs text-muted-foreground">{t('stats.tasksActive')}</p>
            <p className="mt-1 text-xl font-semibold">{agent.summary.tasksActive}</p>
          </div>
          <div className="rounded-xl border bg-card p-3.5">
            <p className="text-xs text-muted-foreground">{t('stats.acceptedPct')}</p>
            <p className="mt-1 text-xl font-semibold">
              {statsQuery.data?.acceptedPct !== null && statsQuery.data?.acceptedPct !== undefined
                ? `${statsQuery.data.acceptedPct}%`
                : '—'}
            </p>
          </div>
          {statsQuery.data && statsQuery.data.streak > 0 && (
            <div className="rounded-xl border bg-card p-3.5">
              <p className="text-xs text-muted-foreground">{t('stats.streak')}</p>
              <p className="mt-1 text-xl font-semibold">{statsQuery.data.streak}</p>
            </div>
          )}
        </div>

        {/* Mobile tabs */}
        <Tabs
          value={mobileTab}
          onValueChange={(value) => setMobileTab(value as 'actions' | 'about')}
          className="lg:hidden"
        >
          <TabsList className="w-full">
            {(['actions', 'about'] as const).map((tabKey) => (
              <TabsTrigger key={tabKey} value={tabKey} className="flex-1">
                {t(`detailTabs.${tabKey}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          {/* Left column: Actions feed */}
          <div className={cn('space-y-4', mobileTab !== 'actions' && 'hidden lg:block')}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{t('detailTabs.actions')}</h2>
              <Tabs value={period} onValueChange={(value) => setPeriod(value as '7d' | '30d')}>
                <TabsList>
                  {(['7d', '30d'] as const).map((p) => (
                    <TabsTrigger key={p} value={p} className="text-xs">
                      {t(`periods.${p}`)}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            {actionsQuery.isLoading && (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
            )}

            {!actionsQuery.isLoading && allActions.length === 0 && (
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
                    const href = actionLink(item, project?.id);
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
                                <p className="mt-0.5 break-words text-xs text-muted-foreground">
                                  {item.details}
                                </p>
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

            {actionsQuery.hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={actionsQuery.isFetchingNextPage}
                onClick={() => void actionsQuery.fetchNextPage()}
              >
                {t('loadMore')}
              </Button>
            )}
          </div>

          {/* Right column: About agent */}
          <div className={cn('space-y-4', mobileTab !== 'about' && 'hidden lg:block')}>
            <h2 className="text-base font-semibold">{t('detailTabs.about')}</h2>

            {agent.template && (
              <>
                <section className="space-y-2 rounded-xl border bg-card p-4">
                  <h3 className="text-sm font-semibold">{t('about.whatDoes')}</h3>
                  <p className="text-sm text-muted-foreground">{agent.template.description}</p>
                </section>

                {agent.template.abilities.length > 0 && (
                  <section className="space-y-2 rounded-xl border bg-card p-4">
                    <h3 className="text-sm font-semibold">{t('about.abilities')}</h3>
                    <ul className="space-y-1.5 text-sm">
                      {agent.template.abilities.map((ab) => (
                        <li key={ab.name}>
                          <span className="font-medium">{ab.name}</span>
                          {ab.text && <span className="text-muted-foreground"> — {ab.text}</span>}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}

            <section className="space-y-2 rounded-xl border bg-card p-4">
              <h3 className="text-sm font-semibold">{t('about.connections')}</h3>
              {agent.connections.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('about.noConnections')}</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {agent.connections.map((c) => (
                    <li key={c.connectionId} className="flex items-center justify-between gap-2">
                      <span>
                        {c.name} ({c.providerKey})
                      </span>
                      <Badge variant="outline" className="text-[11px]">
                        {c.accessLevel} · {c.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {agent.permissions.length > 0 && (
              <section className="space-y-2 rounded-xl border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{t('about.permissions')}</h3>
                </div>
                <p className="text-xs text-muted-foreground">{t('about.permissionsHint')}</p>
                <div className="space-y-1.5 pt-1 text-sm">
                  {agent.permissions.map((perm) => (
                    <div
                      key={perm.actionId}
                      className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                    >
                      <span className="flex items-center gap-1.5 font-mono text-xs">
                        {perm.locked && <Lock className="size-3.5 text-muted-foreground" />}
                        {perm.actionId}
                      </span>
                      <Badge variant="secondary" className="text-[11px]">
                        {perm.locked ? t('about.lockedBySystem') : t(`permModes.${perm.mode}`)}
                      </Badge>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {Object.keys(agent.limits).length > 0 && (
              <section className="space-y-2 rounded-xl border bg-card p-4">
                <h3 className="text-sm font-semibold">{t('about.limits')}</h3>
                <dl className="space-y-1 text-sm">
                  {Object.entries(agent.limits).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-2">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="font-medium">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {agent.instructions.length > 0 && (
              <section className="space-y-2 rounded-xl border bg-card p-4">
                <h3 className="text-sm font-semibold">{t('about.instructions')}</h3>
                <ul className="space-y-1.5 text-sm">
                  {agent.instructions.map((ins, idx) => (
                    <li key={idx}>
                      <span className="font-medium">{ins.topic}:</span>{' '}
                      <span className="text-muted-foreground">{ins.rule}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {(agent.asks.length > 0 || agent.enforcedAsks.length > 0) && (
              <section className="space-y-2 rounded-xl border bg-card p-4">
                <h3 className="text-sm font-semibold">{t('about.alwaysAsk')}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {agent.enforcedAsks.map((ask) => (
                    <Badge key={`enf-${ask}`} variant="default" className="text-xs">
                      {ask} ({t('about.projectRule')})
                    </Badge>
                  ))}
                  {agent.asks.map((ask) => (
                    <Badge key={ask} variant="outline" className="text-xs">
                      {ask}
                    </Badge>
                  ))}
                </div>
              </section>
            )}

            <section className="space-y-2 rounded-xl border bg-card p-4">
              <h3 className="text-sm font-semibold">{t('about.notes')}</h3>
              {agent.notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('about.noNotes')}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {agent.notes.slice(0, 5).map((note) => (
                    <li key={note.id} className="border-b pb-2 last:border-b-0 last:pb-0">
                      <p>{note.text}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {new Date(note.createdAt).toLocaleDateString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2 rounded-xl border bg-card p-4">
              <h3 className="text-sm font-semibold">{t('about.skills')}</h3>
              <div className="flex flex-wrap gap-1.5">
                {BUILTIN_SKILLS.map((skill) => (
                  <Badge key={skill} variant="outline" className="text-xs">
                    {skill}
                  </Badge>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </SectionLayout>
  );
}
