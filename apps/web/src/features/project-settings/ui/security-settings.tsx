'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import type { Project, WorkspaceRole } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import { Input } from '@workspace/ui/components/input';

import { useDeleteProject, usePauseProject, useResumeProject } from '@/entities/project';
import { projectConnectionsKey } from '@/entities/project/operations';
import { hasRoleAtLeast } from '@/entities/workspace';
import { projectOperations } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { useConfirm } from '@/shared/ui/confirm-dialog';
import { SettingsCard, SettingsRow } from '@/shared/ui/settings-card';

export function SecuritySettings({
  project,
  role,
  onDelete,
}: {
  project: Project;
  role: WorkspaceRole;
  onDelete: () => void;
}) {
  const t = useTranslations('projectSettings');
  const format = useFormatter();
  const confirm = useConfirm();
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const [until, setUntil] = useState('');
  const editable = hasRoleAtLeast(role, 'admin');
  const { accountId, id } = project;
  const pause = usePauseProject(accountId, id);
  const resume = useResumeProject(accountId, id);
  const remove = useDeleteProject(accountId, id, () => {
    toast.success(t('deleted'));
    onDelete();
  });
  const disconnect = useMutation({
    mutationFn: projectOperations(accountId, id).disconnectAll,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: projectConnectionsKey(project) });
      toast.success(t('disconnected'));
    },
  });
  const busy = pause.isPending || resume.isPending || remove.isPending || disconnect.isPending;
  const reportError = (error: Error) => toast.error(errorMessage(error));

  async function disconnectAll() {
    if (
      await confirm({
        title: t('disconnect'),
        description: t('disconnectHint'),
        confirmLabel: t('disconnect'),
      })
    ) {
      disconnect.mutate(undefined, { onError: reportError });
    }
  }

  async function deleteProject() {
    if (
      await confirm({
        title: t('delete'),
        description: t('deleteHint'),
        confirmLabel: t('delete'),
        word: project.name,
      })
    ) {
      remove.mutate(project.name, { onError: reportError });
    }
  }

  return (
    <div className="grid gap-4">
      <SettingsCard title={t('team')}>
        <SettingsRow
          label={t('teamState')}
          hint={
            project.pausedUntil
              ? t('pausedUntil', {
                  time: format.dateTime(new Date(project.pausedUntil), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }),
                })
              : undefined
          }
        >
          {project.agentsPaused ? t('paused') : t('running')}
        </SettingsRow>
        {editable &&
          (project.agentsPaused ? (
            <SettingsRow label={t('resume')}>
              <Button disabled={busy} onClick={() => resume.mutate(undefined, { onError: reportError })}>
                {t('resume')}
              </Button>
            </SettingsRow>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const date = until ? new Date(until) : undefined;
                if (date && !(date.getTime() > Date.now())) {
                  toast.error(t('pauseFuture'));
                  return;
                }
                pause.mutate(date, { onSuccess: () => setUntil(''), onError: reportError });
              }}
            >
              <SettingsRow label={t('pauseUntil')} hint={t('pauseHint')} htmlFor="pause-until">
                <Input
                  id="pause-until"
                  type="datetime-local"
                  value={until}
                  disabled={busy}
                  onChange={(event) => setUntil(event.target.value)}
                />
                <Button type="submit" variant="outline" disabled={busy}>
                  {t('pause')}
                </Button>
              </SettingsRow>
            </form>
          ))}
      </SettingsCard>
      {editable && (
        <SettingsCard title={t('danger')}>
          <SettingsRow label={t('disconnect')} hint={t('disconnectHint')}>
            <Button variant="destructive" disabled={busy} onClick={() => void disconnectAll()}>
              {t('disconnect')}
            </Button>
          </SettingsRow>
          {role === 'owner' && (
            <SettingsRow label={t('delete')} hint={t('deleteHint')}>
              <Button variant="destructive" disabled={busy} onClick={() => void deleteProject()}>
                {t('delete')}
              </Button>
            </SettingsRow>
          )}
        </SettingsCard>
      )}
    </div>
  );
}
