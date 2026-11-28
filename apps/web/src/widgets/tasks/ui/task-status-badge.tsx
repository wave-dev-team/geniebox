'use client';

import { useTranslations } from 'next-intl';

import type { ProjectTask, TaskStatus } from '@workspace/types';
import { Badge } from '@workspace/ui/components/badge';

const statusVariant: Record<TaskStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  planned: 'outline',
  running: 'default',
  waiting: 'secondary',
  failed: 'destructive',
  done: 'secondary',
  cancelled: 'outline',
};

export function TaskStatusBadge({ task }: { task: ProjectTask }) {
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
