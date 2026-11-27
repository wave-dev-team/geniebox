'use client';

import { CalendarClock, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { ProjectAgent, ProjectRoutine } from '@workspace/types';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { Switch } from '@workspace/ui/components/switch';

import { AgentIcon } from '@/entities/agent/ui/agent-icon';

export function RoutineCard({
  routine,
  agent,
  canTech,
  running,
  onToggle,
  onRunNow,
}: {
  routine: ProjectRoutine;
  agent?: ProjectAgent;
  canTech: boolean;
  running: boolean;
  onToggle: (enabled: boolean) => void;
  onRunNow: () => void;
}) {
  const t = useTranslations('tasksSection');

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{routine.title}</p>
          <Badge variant={routine.enabled ? 'secondary' : 'outline'}>
            {routine.enabled ? t('routine.enabled') : t('routine.paused')}
          </Badge>
          <Badge variant="outline" className="text-xs">
            <CalendarClock className="mr-1 size-3" />
            {t(`schedules.${routine.schedule}`)}
          </Badge>
        </div>

        {routine.description && (
          <p className="line-clamp-2 text-sm text-muted-foreground">{routine.description}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {agent && (
            <span className="inline-flex items-center gap-1.5 text-foreground/80">
              <AgentIcon icon={agent.icon} size="sm" />
              <span>{agent.displayName}</span>
            </span>
          )}
          {routine.nextRunAt && (
            <span>{t('routine.nextRun', { date: new Date(routine.nextRunAt).toLocaleString() })}</span>
          )}
          {routine.lastRunAt && (
            <span>{t('routine.lastRun', { date: new Date(routine.lastRunAt).toLocaleString() })}</span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {canTech && (
          <>
            <Button size="sm" variant="outline" disabled={running} onClick={onRunNow}>
              <Play className="mr-1.5 size-3.5" />
              {t('routine.runNow')}
            </Button>
            <Switch
              checked={routine.enabled}
              onCheckedChange={(checked) => onToggle(checked)}
              aria-label={routine.title}
            />
          </>
        )}
      </div>
    </div>
  );
}
