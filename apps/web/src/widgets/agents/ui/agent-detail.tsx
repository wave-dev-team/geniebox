'use client';

import { ArrowLeft, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { Skeleton } from '@workspace/ui/components/skeleton';
import { Switch } from '@workspace/ui/components/switch';
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs';

import { AgentAboutPanel } from './agent-about-panel';
import { AgentActionsFeed } from './agent-actions-feed';

import { useAgent, useAgentActions, useAgentStats, useToggleAgent } from '@/entities/agent/model/hooks';
import { AgentIcon } from '@/entities/agent/ui/agent-icon';
import { useActiveProject } from '@/entities/project/use-active-project';
import { ApiError } from '@/shared/api';
import { routes } from '@/shared/config/routes';
import { SectionLayout } from '@/widgets/section-layout';

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
          <AgentActionsFeed
            pages={actionsQuery.data?.pages}
            isLoading={actionsQuery.isLoading}
            hasNextPage={Boolean(actionsQuery.hasNextPage)}
            isFetchingNextPage={actionsQuery.isFetchingNextPage}
            period={period}
            projectId={project?.id}
            visible={mobileTab === 'actions'}
            onPeriodChange={setPeriod}
            onLoadMore={() => void actionsQuery.fetchNextPage()}
          />
          <AgentAboutPanel agent={agent} visible={mobileTab === 'about'} />
        </div>
      </div>
    </SectionLayout>
  );
}
