'use client';

import { AlertCircle, CheckCircle2, Circle, Loader2, Play, RotateCcw, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import type { ProjectAgent, ProjectTask } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog';
import { Skeleton } from '@workspace/ui/components/skeleton';

import { TaskStatusBadge } from './task-status-badge';

import { AgentIcon } from '@/entities/agent/ui/agent-icon';
import { routes } from '@/shared/config/routes';

export function TaskDetailModal({
  task,
  projectId,
  loading,
  agentsMap,
  canTech,
  busy,
  onClose,
  onRun,
  onCancel,
}: {
  task?: ProjectTask;
  projectId?: string;
  loading: boolean;
  agentsMap: Map<string, ProjectAgent>;
  canTech: boolean;
  busy: boolean;
  onClose: () => void;
  onRun: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const t = useTranslations('tasksSection');
  const agent = task ? agentsMap.get(task.agentId) : undefined;
  const delegator = task?.assignedByAgentId ? agentsMap.get(task.assignedByAgentId) : undefined;
  const canRun = Boolean(task && canTech && (task.status === 'planned' || task.status === 'failed'));
  const canCancel = Boolean(
    task && canTech && (task.status === 'planned' || task.status === 'running' || task.status === 'waiting'),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader className="pr-8">
          <DialogTitle className="wrap-anywhere">{task?.title ?? t('detail.title')}</DialogTitle>
          <DialogDescription>{task ? t(`origin.${task.origin}`) : t('detail.title')}</DialogDescription>
        </DialogHeader>

        {loading && !task && (
          <div className="space-y-3 py-4">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}

        {task && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <TaskStatusBadge task={task} />
              {agent && (
                <span className="inline-flex items-center gap-1.5 text-foreground">
                  <AgentIcon icon={agent.icon} size="sm" />
                  <span>{agent.displayName}</span>
                </span>
              )}
              {delegator && delegator.id !== agent?.id && (
                <span>{t('tree.delegatedBy', { name: delegator.displayName })}</span>
              )}
            </div>

            {task.description ? (
              <p className="wrap-anywhere whitespace-pre-wrap text-sm">{task.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{t('detail.noDescription')}</p>
            )}

            {task.steps.length > 0 && (
              <section className="space-y-2 rounded-xl border p-4">
                <h3 className="text-sm font-semibold">{t('detail.steps')}</h3>
                <ul className="space-y-2">
                  {[...task.steps]
                    .sort((a, b) => a.position - b.position)
                    .map((step) => (
                      <li key={step.position} className="flex items-start gap-2.5 text-sm">
                        {step.status === 'done' ? (
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                        ) : step.status === 'current' ? (
                          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
                        ) : step.status === 'failed' ? (
                          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                        ) : (
                          <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{step.title}</p>
                          {step.note && <p className="text-xs text-muted-foreground">{step.note}</p>}
                        </div>
                      </li>
                    ))}
                </ul>
              </section>
            )}

            {task.facts.length > 0 && (
              <section className="space-y-2 rounded-xl border p-4">
                <h3 className="text-sm font-semibold">{t('detail.facts')}</h3>
                <dl className="grid gap-2 sm:grid-cols-2">
                  {task.facts.map((fact, idx) => (
                    <div key={idx} className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
                      <dt className="text-xs text-muted-foreground">{fact.label}</dt>
                      <dd className="font-medium">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {task.result && (
              <section className="space-y-1.5 rounded-xl border bg-muted/30 p-4">
                <h3 className="text-sm font-semibold">{t('detail.result')}</h3>
                <p className="wrap-anywhere whitespace-pre-wrap text-sm">{task.result}</p>
              </section>
            )}

            {task.error && (
              <section className="space-y-1.5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
                <div className="flex items-center gap-2 font-semibold text-destructive">
                  <AlertCircle className="size-4" />
                  <span>{t('detail.error')}</span>
                </div>
                <p>{task.error.what}</p>
                {task.error.fix && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">{t('detail.fix')}:</span> {task.error.fix}
                  </p>
                )}
              </section>
            )}

            <div className="flex flex-wrap gap-2">
              {task.decisionId && projectId && (
                <Button
                  nativeButton={false}
                  render={<Link href={routes.chat(projectId)} />}
                  variant="outline"
                  size="sm"
                >
                  {t('detail.openDecision')}
                </Button>
              )}
              {canRun && (
                <Button size="sm" disabled={busy} onClick={() => onRun(task.id)}>
                  {task.status === 'failed' ? (
                    <>
                      <RotateCcw className="mr-1.5 size-4" />
                      {t('detail.retry')}
                    </>
                  ) : (
                    <>
                      <Play className="mr-1.5 size-4" />
                      {t('detail.runNow')}
                    </>
                  )}
                </Button>
              )}
              {canCancel && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onCancel(task.id)}>
                  {t('detail.cancel')}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
