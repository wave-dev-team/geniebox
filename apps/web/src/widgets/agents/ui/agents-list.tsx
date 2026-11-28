'use client';

import { MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { Skeleton } from '@workspace/ui/components/skeleton';
import { Switch } from '@workspace/ui/components/switch';
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs';

import { useToggleAgent } from '@/entities/agent/model/hooks';
import { AgentIcon } from '@/entities/agent/ui/agent-icon';
import { useProjectAgents } from '@/entities/project/operations';
import { useActiveProject } from '@/entities/project/use-active-project';
import { routes } from '@/shared/config/routes';
import { SectionLayout } from '@/widgets/section-layout';

type Filter = 'all' | 'active' | 'paused';

export function AgentsList() {
  const t = useTranslations('agentsSection');
  const tCommon = useTranslations('common');
  const { project, projectRef, isLoading: projectLoading, canAdmin } = useActiveProject();
  const agents = useProjectAgents(projectRef);
  const toggle = useToggleAgent(projectRef);
  const [filter, setFilter] = useState<Filter>('all');

  const team = (agents.data ?? []).filter((a) => a.kind !== 'manager');
  const visible = team.filter((a) => {
    if (filter === 'active') return a.status !== 'paused';
    if (filter === 'paused') return a.status === 'paused';
    return true;
  });

  return (
    <SectionLayout
      title={t('title')}
      subtitle={t('subtitle')}
      nav={[]}
      action={
        project ? (
          <Button
            nativeButton={false}
            render={<Link href={routes.chat(project.id)} />}
            size="sm"
            variant="outline"
            className="w-full sm:w-auto"
          >
            <MessageSquare className="mr-2 size-4 shrink-0" />
            {t('askManager')}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
          <Tabs
            value={filter}
            onValueChange={(value) => setFilter(value as Filter)}
            className="w-full sm:w-auto"
          >
            <TabsList className="w-full sm:w-auto">
              {(['all', 'active', 'paused'] as const).map((key) => (
                <TabsTrigger key={key} value={key} className="flex-1 sm:flex-initial">
                  {t(`filters.${key}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <span className="text-sm text-muted-foreground">{t('found', { count: visible.length })}</span>
        </div>

        {(projectLoading || agents.isLoading) && (
          <div className="grid grid-cols-1 gap-4 @min-[38rem]/section-layout:grid-cols-2">
            {Array.from({ length: 4 }).map((_, idx) => (
              <Skeleton key={idx} className="h-40 rounded-xl" />
            ))}
          </div>
        )}

        {agents.isError && (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6">
            <p className="text-sm font-medium">{t('loadError')}</p>
            <Button size="sm" variant="outline" onClick={() => void agents.refetch()}>
              {tCommon('retry')}
            </Button>
          </div>
        )}

        {!projectLoading && !agents.isLoading && !agents.isError && visible.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-10 text-center">
            <p className="text-sm font-medium">{t('emptyTitle')}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{t('emptyHint')}</p>
            {project && (
              <Button
                nativeButton={false}
                render={<Link href={routes.chat(project.id)} />}
                size="sm"
                variant="outline"
              >
                {t('askManager')}
              </Button>
            )}
          </div>
        )}

        {!agents.isLoading && !agents.isError && visible.length > 0 && (
          <div className="grid grid-cols-1 gap-4 @min-[38rem]/section-layout:grid-cols-2">
            {visible.map((agent) => {
              const isActive = agent.status !== 'paused';
              return (
                <div
                  key={agent.id}
                  className="group relative flex min-w-0 flex-col justify-between gap-4 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20 sm:p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={routes.agents(agent.id)}
                      className="flex min-w-0 flex-1 items-start gap-3 focus-visible:outline-none"
                    >
                      <AgentIcon icon={agent.icon} kind={agent.kind} size="md" />
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold group-hover:underline">{agent.displayName}</h3>
                        {agent.roleText && (
                          <p className="truncate text-sm text-muted-foreground">{agent.roleText}</p>
                        )}
                      </div>
                    </Link>
                    <Switch
                      className="shrink-0"
                      checked={isActive}
                      disabled={!canAdmin || toggle.isPending}
                      aria-label={t('toggleLabel', { name: agent.displayName })}
                      onCheckedChange={(next) => toggle.mutate({ agentId: agent.id, pause: !next })}
                    />
                  </div>

                  <Link href={routes.agents(agent.id)} className="space-y-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{t('metrics.actionsWeek', { count: agent.summary.actionsWeek })}</span>
                      <span>{t('metrics.tasksActive', { count: agent.summary.tasksActive })}</span>
                      {agent.summary.acceptedPct !== null && (
                        <span>{t('metrics.acceptedPct', { pct: agent.summary.acceptedPct })}</span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <Badge variant={isActive ? 'default' : 'secondary'}>
                        {isActive ? t('status.active') : t('status.paused')}
                      </Badge>
                      {agent.connections.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {agent.connections.slice(0, 3).map((conn) => (
                            <Badge key={conn.connectionId} variant="outline" className="text-[11px]">
                              {conn.providerKey}
                              {conn.status === 'error' ? ' !' : ''}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SectionLayout>
  );
}
