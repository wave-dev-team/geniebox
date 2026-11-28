'use client';

import { CalendarClock, ClipboardList, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { z } from 'zod';

import type { ProjectAgent } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';
import { Skeleton } from '@workspace/ui/components/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs';

import { RoutineCard } from './routine-card';
import { TaskDetailModal } from './task-detail-modal';
import { buildTaskTree, TaskTreeRow } from './task-tree-row';

import { useProjectAgents } from '@/entities/project/operations';
import { useTasksBoard } from '@/features/tasks/model/use-tasks';
import { routes } from '@/shared/config/routes';
import { SectionLayout } from '@/widgets/section-layout';

const boardTabSchema = z.enum(['active', 'routines', 'done']);
type BoardTab = z.infer<typeof boardTabSchema>;

export function TasksBoard() {
  const t = useTranslations('tasksSection');
  const tAgents = useTranslations('agentsSection');
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
        board.project ? (
          <Button
            nativeButton={false}
            render={<Link href={routes.chat(board.project.id)} />}
            size="sm"
            variant="outline"
            className="w-full sm:w-auto"
          >
            <MessageSquare className="mr-2 size-4 shrink-0" />
            {tAgents('askManager')}
          </Button>
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
    </SectionLayout>
  );
}
