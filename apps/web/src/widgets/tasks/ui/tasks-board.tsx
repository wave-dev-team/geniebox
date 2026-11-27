'use client';

import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ClipboardList,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { z } from 'zod';

import type { ProjectAgent, ProjectRoutine, ProjectTask, TaskStatus } from '@workspace/types';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';
import { Skeleton } from '@workspace/ui/components/skeleton';
import { Switch } from '@workspace/ui/components/switch';
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs';
import { cn } from '@workspace/ui/lib/utils';

import { AgentIcon } from '@/entities/agent/ui/agent-icon';
import { useProjectAgents } from '@/entities/project/operations';
import { useTasksBoard } from '@/features/tasks/model/use-tasks';
import { CreateRoutineDialog, CreateTaskDialog } from '@/features/tasks/ui/task-editor';
import { routes } from '@/shared/config/routes';
import { SectionLayout } from '@/widgets/section-layout';

const boardTabSchema = z.enum(['active', 'routines', 'done']);
type BoardTab = z.infer<typeof boardTabSchema>;

const statusVariant: Record<TaskStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  planned: 'outline',
  running: 'default',
  waiting: 'secondary',
  failed: 'destructive',
  done: 'secondary',
  cancelled: 'outline',
};

function TaskStatusBadge({ task }: { task: ProjectTask }) {
  const t = useTranslations('tasksSection');
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant={statusVariant[task.status]}>{t(`status.${task.status}`)}</Badge>
      {task.status === 'waiting' && task.waitingReason && (
        <Badge variant="outline" className="text-xs">
          {t(`waitingReason.${task.waitingReason}`)}
        </Badge>
      )}
    </div>
  );
}

function buildTaskTree(tasks: ProjectTask[]) {
  const byId = new Map<string, ProjectTask>();
  for (const task of tasks) {
    byId.set(task.id, task);
  }
  const childrenMap = new Map<string, ProjectTask[]>();
  const roots: ProjectTask[] = [];
  for (const task of tasks) {
    if (task.parentTaskId && byId.has(task.parentTaskId)) {
      const list = childrenMap.get(task.parentTaskId) ?? [];
      list.push(task);
      childrenMap.set(task.parentTaskId, list);
    } else {
      roots.push(task);
    }
  }
  return { roots, childrenMap };
}

function TaskTreeRow({
  task,
  depth,
  childrenMap,
  agentsMap,
  expandedIds,
  onToggleExpand,
  onSelect,
}: {
  task: ProjectTask;
  depth: number;
  childrenMap: Map<string, ProjectTask[]>;
  agentsMap: Map<string, ProjectAgent>;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations('tasksSection');
  const children = childrenMap.get(task.id) ?? [];
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(task.id);
  const agent = agentsMap.get(task.agentId);
  const delegator = task.assignedByAgentId ? agentsMap.get(task.assignedByAgentId) : undefined;

  return (
    <div className="divide-y-0">
      <div
        className={cn(
          'flex items-center gap-2 border-b px-3 py-3 transition-colors hover:bg-muted/40 sm:px-4',
          depth > 0 && 'bg-muted/15',
        )}
        style={{ paddingLeft: `${12 + Math.min(depth, 3) * 24}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={isExpanded ? t('tree.collapse') : t('tree.expand')}
            onClick={() => onToggleExpand(task.id)}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ) : (
          <span className="w-6 shrink-0" />
        )}

        <button
          type="button"
          onClick={() => onSelect(task.id)}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium">{task.title}</p>
              {hasChildren && (
                <Badge variant="outline" className="text-[11px]">
                  {t('tree.subtasksCount', { count: children.length })}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {agent && (
                <span className="inline-flex items-center gap-1.5">
                  <AgentIcon icon={agent.icon} size="sm" />
                  <span>{agent.displayName}</span>
                </span>
              )}
              {delegator && delegator.id !== agent?.id && (
                <span>{t('tree.delegatedBy', { name: delegator.displayName })}</span>
              )}
              {task.progressText && task.status === 'running' && (
                <span className="truncate text-foreground/80">{task.progressText}</span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <TaskStatusBadge task={task} />
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          </div>
        </button>
      </div>

      {hasChildren && isExpanded && (
        <div>
          {children.map((child) => (
            <TaskTreeRow
              key={child.id}
              task={child}
              depth={depth + 1}
              childrenMap={childrenMap}
              agentsMap={agentsMap}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskDetailModal({
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

function RoutineCard({
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

export function TasksBoard() {
  const t = useTranslations('tasksSection');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const tab: BoardTab = boardTabSchema.safeParse(search.get('tab')).data ?? 'active';
  const agentId = z.uuid().safeParse(search.get('agent')).data;
  const taskId = z.uuid().safeParse(search.get('task')).data;

  const board = useTasksBoard(tab, agentId, taskId);
  const agentsQuery = useProjectAgents(board.projectRef);
  const agents = agentsQuery.data ?? [];

  const agentsMap = useMemo(() => {
    const map = new Map<string, ProjectAgent>();
    for (const a of agents) {
      map.set(a.id, a);
    }
    return map;
  }, [agents]);

  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [createRoutineOpen, setCreateRoutineOpen] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const tasks = board.tasksQuery.data ?? [];
  const { roots, childrenMap } = useMemo(() => buildTaskTree(tasks), [tasks]);

  const expandedIds = useMemo(() => {
    const set = new Set<string>();
    for (const task of tasks) {
      if (!collapsedIds.has(task.id)) set.add(task.id);
    }
    return set;
  }, [tasks, collapsedIds]);

  function toggleExpand(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function navigate(patch: Record<string, string | undefined>) {
    const params = new URLSearchParams(search);
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.replace(`${pathname}${params.size ? `?${params.toString()}` : ''}`, { scroll: false });
  }

  const selectedTask = board.taskQuery.data ?? tasks.find((item) => item.id === taskId);
  const selectedAgent = agents.find((a) => a.id === agentId);
  const busyAction = board.runTask.isPending || board.cancelTask.isPending;

  return (
    <SectionLayout
      title={t('title')}
      subtitle={t('subtitle')}
      nav={[]}
      action={
        board.canTech && agents.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setCreateRoutineOpen(true)}>
              <CalendarClock className="mr-1.5 size-4" />
              {t('createRoutineButton')}
            </Button>
            <Button size="sm" onClick={() => setCreateTaskOpen(true)}>
              <Plus className="mr-1.5 size-4" />
              {t('createTaskButton')}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            value={tab}
            onValueChange={(value) => navigate({ tab: value === 'active' ? undefined : value })}
          >
            <TabsList>
              {(['active', 'routines', 'done'] as const).map((key) => (
                <TabsTrigger key={key} value={key} className="gap-1.5">
                  <span>{t(`tabs.${key}`)}</span>
                  {board.countsQuery.data && (
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {board.countsQuery.data[key]}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {agents.length > 0 && (
            <Select
              value={selectedAgent?.id ?? 'all'}
              onValueChange={(value) => navigate({ agent: value && value !== 'all' ? value : undefined })}
            >
              <SelectTrigger className="w-[220px]" aria-label={t('filters.agent')}>
                <SelectValue>{selectedAgent?.displayName ?? t('filters.allAgents')}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('filters.allAgents')}</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {(board.projectLoading ||
          (tab !== 'routines' && board.tasksQuery.isLoading) ||
          (tab === 'routines' && board.routinesQuery.isLoading)) && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, idx) => (
              <Skeleton key={idx} className="h-16 rounded-xl" />
            ))}
          </div>
        )}

        {((tab !== 'routines' && board.tasksQuery.isError) ||
          (tab === 'routines' && board.routinesQuery.isError)) && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm text-destructive">{t('loadError')}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void (tab === 'routines' ? board.routinesQuery.refetch() : board.tasksQuery.refetch())
              }
            >
              {tCommon('retry')}
            </Button>
          </div>
        )}

        {tab !== 'routines' &&
          !board.tasksQuery.isLoading &&
          !board.tasksQuery.isError &&
          tasks.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-5 py-12 text-center">
              <ClipboardList className="size-6 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                {t(tab === 'done' ? 'emptyDone' : 'emptyActive')}
              </p>
            </div>
          )}

        {tab !== 'routines' &&
          !board.tasksQuery.isLoading &&
          !board.tasksQuery.isError &&
          roots.length > 0 && (
            <div className="overflow-hidden rounded-xl border bg-card">
              {roots.map((root) => (
                <TaskTreeRow
                  key={root.id}
                  task={root}
                  depth={0}
                  childrenMap={childrenMap}
                  agentsMap={agentsMap}
                  expandedIds={expandedIds}
                  onToggleExpand={toggleExpand}
                  onSelect={(id) => navigate({ task: id })}
                />
              ))}
            </div>
          )}

        {tab === 'routines' &&
          !board.routinesQuery.isLoading &&
          !board.routinesQuery.isError &&
          (board.routinesQuery.data?.length ?? 0) === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-5 py-12 text-center">
              <CalendarClock className="size-6 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">{t('emptyRoutines')}</p>
            </div>
          )}

        {tab === 'routines' &&
          !board.routinesQuery.isLoading &&
          !board.routinesQuery.isError &&
          (board.routinesQuery.data?.length ?? 0) > 0 && (
            <div className="space-y-3">
              {board.routinesQuery.data!.map((routine) => (
                <RoutineCard
                  key={routine.id}
                  routine={routine}
                  agent={agentsMap.get(routine.agentId)}
                  canTech={board.canTech}
                  running={board.runRoutine.isPending}
                  onToggle={(enabled) => board.updateRoutine.mutate({ id: routine.id, input: { enabled } })}
                  onRunNow={() => board.runRoutine.mutate(routine.id)}
                />
              ))}
            </div>
          )}
      </div>

      {taskId && (
        <TaskDetailModal
          task={selectedTask}
          projectId={board.project?.id}
          loading={board.taskQuery.isLoading}
          agentsMap={agentsMap}
          canTech={board.canTech}
          busy={busyAction}
          onClose={() => navigate({ task: undefined })}
          onRun={(id) => board.runTask.mutate(id)}
          onCancel={(id) => board.cancelTask.mutate(id)}
        />
      )}

      <CreateTaskDialog
        open={createTaskOpen}
        onOpenChange={setCreateTaskOpen}
        agents={agents}
        isPending={board.createTask.isPending}
        onSubmit={async (input) => {
          const created = await board.createTask.mutateAsync(input);
          navigate({ tab: undefined, task: created.id });
        }}
      />

      <CreateRoutineDialog
        open={createRoutineOpen}
        onOpenChange={setCreateRoutineOpen}
        agents={agents}
        isPending={board.createRoutine.isPending}
        onSubmit={async (input) => {
          await board.createRoutine.mutateAsync(input);
          navigate({ tab: 'routines' });
        }}
      />
    </SectionLayout>
  );
}
