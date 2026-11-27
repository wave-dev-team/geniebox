'use client';

import { ChevronRight, ClipboardList, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { z } from 'zod';

import { type TaskAction, type TaskTab, taskTabSchema, type WorkTask } from '@workspace/types';
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
import { Spinner } from '@workspace/ui/components/spinner';
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs';

import { useTasks } from '@/features/tasks/model/use-tasks';
import { TaskEditor } from '@/features/tasks/ui/task-editor';
import { businessApiAvailable } from '@/shared/api';
import { routes } from '@/shared/config/routes';

const statuses = {
  planned: 'outline',
  running: 'secondary',
  failed: 'destructive',
  done: 'secondary',
  cancelled: 'outline',
} as const;

const groups = [
  'running',
  'attention',
  'today',
  'tomorrow',
  'later',
  'unscheduled',
  'yesterday',
  'earlier',
] as const;

function localDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function groupTasks(tasks: WorkTask[], tab: TaskTab) {
  const current = new Date();
  const today = localDate(current);
  const yesterday = localDate(new Date(current.getFullYear(), current.getMonth(), current.getDate() - 1));
  const tomorrow = localDate(new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1));
  const grouped = new Map<(typeof groups)[number], WorkTask[]>();
  for (const task of tasks) {
    let group: (typeof groups)[number];
    if (tab === 'done') {
      const day = localDate(new Date(task.updatedAt));
      group = day === today ? 'today' : day === yesterday ? 'yesterday' : 'earlier';
    } else if (task.status === 'running') {
      group = 'running';
    } else if (task.status === 'failed' || (task.dueOn && task.dueOn < today)) {
      group = 'attention';
    } else if (!task.dueOn) {
      group = 'unscheduled';
    } else {
      group = task.dueOn === today ? 'today' : task.dueOn === tomorrow ? 'tomorrow' : 'later';
    }
    const items = grouped.get(group) ?? [];
    items.push(task);
    grouped.set(group, items);
  }
  return grouped;
}

function TaskBadge({ task }: { task: WorkTask }) {
  const t = useTranslations('tasks.status');
  return <Badge variant={statuses[task.status]}>{t(task.status)}</Badge>;
}

function DueDate({ date }: { date: string }) {
  const t = useTranslations('tasks');
  const f = useFormatter();
  const day = new Date(`${date}T00:00:00Z`);
  const display = f.dateTime(day, {
    day: 'numeric',
    month: 'short',
    ...(day.getUTCFullYear() !== new Date().getFullYear() && { year: 'numeric' }),
    timeZone: 'UTC',
  });
  return <time dateTime={date}>{t('deadline', { date: display })}</time>;
}

function TaskDetails({
  task,
  loading,
  failed,
  busy,
  actionError,
  onClose,
  onEdit,
  onAction,
}: {
  task?: WorkTask;
  loading: boolean;
  failed: boolean;
  busy: boolean;
  actionError: boolean;
  onClose: () => void;
  onEdit: () => void;
  onAction: (action: TaskAction) => void;
}) {
  const t = useTranslations('tasks');
  const mutable = task && !task.turnId && !['done', 'cancelled'].includes(task.status);
  const personal = task && !task.agentId;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader className="pr-8">
          <DialogTitle className="wrap-anywhere">{task?.title ?? t('details')}</DialogTitle>
          <DialogDescription>{task?.turnId ? t('fromChat') : t('details')}</DialogDescription>
        </DialogHeader>
        {loading && <Spinner className="text-muted-foreground" />}
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            {t('detailError')}
          </p>
        )}
        {task && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <TaskBadge task={task} />
              <span>{task.agentName ?? t('self')}</span>
              {task.dueOn && <DueDate date={task.dueOn} />}
            </div>
            {task.description && <p className="wrap-anywhere whitespace-pre-wrap">{task.description}</p>}
            {task.result && (
              <section className="flex flex-col gap-2 rounded-xl border bg-muted/30 p-4">
                <h2 className="font-medium">{t('result')}</h2>
                <p className="wrap-anywhere whitespace-pre-wrap">{task.result}</p>
              </section>
            )}
            {task.status === 'failed' && <p className="text-sm text-muted-foreground">{t('failed')}</p>}
            {actionError && (
              <p role="alert" className="text-sm text-destructive">
                {t('actionError')}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {task.turnId && (
                <Button variant="outline" nativeButton={false} render={<Link href={routes.chat()} />}>
                  {t('openChat')}
                </Button>
              )}
              {mutable && (
                <>
                  {personal && (
                    <>
                      <Button variant="outline" disabled={busy} onClick={onEdit}>
                        {t('edit')}
                      </Button>
                      {task.status === 'planned' && (
                        <Button variant="outline" disabled={busy} onClick={() => onAction('start')}>
                          {t('start')}
                        </Button>
                      )}
                      <Button disabled={busy} onClick={() => onAction('complete')}>
                        {t('complete')}
                      </Button>
                    </>
                  )}
                  {task.status === 'failed' && (
                    <Button disabled={busy} onClick={() => onAction('retry')}>
                      {t('retry')}
                    </Button>
                  )}
                  <Button variant="outline" disabled={busy} onClick={() => onAction('cancel')}>
                    {t('cancel')}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function TasksBoard() {
  const t = useTranslations('tasks');
  const unavailable = useTranslations('app')('businessUnavailable');
  const tRoutines = useTranslations('routines');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const tab = taskTabSchema.safeParse(search.get('tab')).data ?? 'active';
  const agentId = z.uuid().safeParse(search.get('agent')).data;
  const taskId = z.uuid().safeParse(search.get('task')).data;
  const board = useTasks(tab, agentId, taskId);
  const grouped = groupTasks(board.tasks, tab);
  const agents = board.agents.data ?? [];
  const filtered = agents.find(({ id }) => id === agentId);

  function navigate(patch: Record<string, string | undefined>) {
    const params = new URLSearchParams(search);
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.replace(`${pathname}${params.size ? `?${params.toString()}` : ''}`, { scroll: false });
  }

  return (
    <div className="mx-auto flex w-full max-w-260 flex-col gap-6 px-5 pt-14 pb-10 sm:px-8 md:py-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
            <Link className="text-sm text-muted-foreground underline underline-offset-4" href="/routines">
              {tRoutines('title')}
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button disabled={!businessApiAvailable} onClick={() => setCreating(true)}>
          <Plus />
          {t('create')}
        </Button>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(value) => navigate({ tab: value === 'done' ? 'done' : undefined })}>
          <TabsList>
            {(['active', 'done'] as const).map((item) => (
              <TabsTrigger key={item} value={item}>
                {t(`tabs.${item}`)}
                {board.counts.data && (
                  <span className="tabular-nums text-muted-foreground">{board.counts.data[item]}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {agents.length > 0 && (
          <Select
            value={filtered?.id ?? 'all'}
            onValueChange={(value) => navigate({ agent: value && value !== 'all' ? value : undefined })}
          >
            <SelectTrigger aria-label={t('filter')}>
              <SelectValue>{filtered?.name ?? t('all')}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('all')}</SelectItem>
              {agents.map(({ id, name }) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {!businessApiAvailable && <p className="text-sm text-muted-foreground">{unavailable}</p>}
      {board.list.isLoading && <Spinner className="mx-auto my-10 text-muted-foreground" />}
      {board.list.isError && (
        <div className="flex items-center gap-3">
          <p role="alert" className="text-sm text-destructive">
            {t('loadError')}
          </p>
          <Button size="sm" variant="outline" onClick={() => void board.list.refetch()}>
            {t('retry')}
          </Button>
        </div>
      )}
      {board.list.isSuccess && board.tasks.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border px-5 py-12 text-center">
          <ClipboardList className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{t(tab === 'done' ? 'emptyDone' : 'emptyActive')}</p>
        </div>
      )}
      {groups.map((group) => {
        const items = grouped.get(group);
        if (!items?.length) return null;
        return (
          <section key={group} className="flex flex-col gap-2">
            <h2 className="text-sm text-muted-foreground">{t(`groups.${group}`)}</h2>
            <ul className="divide-y overflow-hidden rounded-xl border">
              {items.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    className="flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 sm:px-4"
                    onClick={() => {
                      board.action.reset();
                      navigate({ task: task.id });
                    }}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-sm font-medium">{task.title}</p>
                      <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        <span>{task.agentName ?? t('self')}</span>
                        {task.dueOn && <DueDate date={task.dueOn} />}
                      </div>
                    </div>
                    <TaskBadge task={task} />
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {board.list.hasNextPage && (
        <Button
          className="self-center"
          variant="outline"
          disabled={board.list.isFetchingNextPage}
          onClick={() => void board.list.fetchNextPage()}
        >
          {t('more')}
        </Button>
      )}
      {businessApiAvailable && taskId && !editing && !creating && (
        <TaskDetails
          task={board.detail.data}
          loading={board.detail.isPending}
          failed={board.detail.isError}
          busy={board.action.isPending}
          actionError={board.action.isError}
          onClose={() => navigate({ task: undefined })}
          onEdit={() => setEditing(true)}
          onAction={(action) => board.action.mutate({ id: taskId, action })}
        />
      )}
      {(creating || (editing && board.detail.data)) && (
        <TaskEditor
          item={editing ? board.detail.data : undefined}
          agents={agents}
          preferredAgent={agentId}
          onClose={() => {
            setCreating(false);
            setEditing(false);
          }}
          onSave={async (values) => {
            const updated = await board.save(values, editing ? taskId : undefined);
            navigate({ task: updated.id, ...(!editing && { tab: undefined }) });
            setCreating(false);
            setEditing(false);
            return updated;
          }}
        />
      )}
    </div>
  );
}
