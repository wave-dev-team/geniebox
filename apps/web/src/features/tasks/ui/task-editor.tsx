'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  type CreateProjectRoutine,
  type CreateProjectTask,
  type ProjectAgent,
  type ScheduleKey,
  scheduleKeys,
} from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog';
import { Input } from '@workspace/ui/components/input';
import { Label } from '@workspace/ui/components/label';
import { Textarea } from '@workspace/ui/components/textarea';

export function CreateTaskDialog({
  open,
  onOpenChange,
  agents,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: ProjectAgent[];
  isPending: boolean;
  onSubmit: (input: CreateProjectTask) => Promise<unknown>;
}) {
  const t = useTranslations('tasksSection');
  const tCommon = useTranslations('common');
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const selectedAgent = agentId || agents[0]?.id || '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedAgent || !title.trim()) return;
    await onSubmit({
      agentId: selectedAgent,
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
    });
    setTitle('');
    setDescription('');
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('createTask.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="task-agent">{t('createTask.agent')}</Label>
            <select
              id="task-agent"
              value={selectedAgent}
              onChange={(e) => setAgentId(e.target.value)}
              className="flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-title">{t('createTask.name')}</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('createTask.namePlaceholder')}
              maxLength={160}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-desc">{t('createTask.why')}</Label>
            <Textarea
              id="task-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('createTask.whyPlaceholder')}
              maxLength={2000}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={isPending || !selectedAgent || !title.trim()}>
              {t('createTask.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CreateRoutineDialog({
  open,
  onOpenChange,
  agents,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: ProjectAgent[];
  isPending: boolean;
  onSubmit: (input: CreateProjectRoutine) => Promise<unknown>;
}) {
  const t = useTranslations('tasksSection');
  const tCommon = useTranslations('common');
  const specialists = agents.filter((a) => a.kind !== 'manager');
  const [agentId, setAgentId] = useState(specialists[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [schedule, setSchedule] = useState<ScheduleKey>('daily_09');

  const selectedAgent = agentId || specialists[0]?.id || '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedAgent || !title.trim()) return;
    await onSubmit({
      agentId: selectedAgent,
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      schedule,
    });
    setTitle('');
    setDescription('');
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('createRoutine.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="routine-agent">{t('createRoutine.agent')}</Label>
            <select
              id="routine-agent"
              value={selectedAgent}
              onChange={(e) => setAgentId(e.target.value)}
              className="flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {specialists.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="routine-title">{t('createRoutine.name')}</Label>
            <Input
              id="routine-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="routine-schedule">{t('createRoutine.schedule')}</Label>
            <select
              id="routine-schedule"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value as ScheduleKey)}
              className="flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {scheduleKeys.map((key) => (
                <option key={key} value={key}>
                  {t(`schedules.${key}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="routine-desc">{t('createRoutine.description')}</Label>
            <Textarea
              id="routine-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={isPending || !selectedAgent || !title.trim()}>
              {t('createRoutine.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
