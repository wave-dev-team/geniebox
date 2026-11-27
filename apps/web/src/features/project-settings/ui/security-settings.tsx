'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import type { Project, WorkspaceRole } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog';
import { Input } from '@workspace/ui/components/input';

import {
  CLIENT_DATA_RETENTION_DAYS,
  JOURNAL_RETENTION_DAYS,
  useDeleteProject,
  usePauseProject,
  useResumeProject,
  useUpdateProject,
} from '@/entities/project';
import { projectConnectionsKey } from '@/entities/project/operations';
import { hasRoleAtLeast } from '@/entities/workspace';
import { projectOperations } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { useConfirm } from '@/shared/ui/confirm-dialog';
import { OptionSelect } from '@/shared/ui/option-select';
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
  const options = useTranslations('projectOptions');
  const common = useTranslations('common');
  const [pausing, setPausing] = useState(false);
  const confirm = useConfirm();
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const [until, setUntil] = useState('');
  const editable = hasRoleAtLeast(role, 'admin');
  const { accountId, id } = project;
  const update = useUpdateProject(accountId, id);
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
    <div className="flex flex-col gap-4">
      <SettingsCard title={t('tabs.journal')} description={t('journalHint')}>
        <SettingsRow label={t('journalRetention')} htmlFor="security-journal">
          <OptionSelect<number>
            id="security-journal"
            value={project.journalRetentionDays}
            options={JOURNAL_RETENTION_DAYS}
            label={(count) => options('days', { count })}
            onChange={(journalRetentionDays) =>
              update.mutate({ journalRetentionDays }, { onError: reportError })
            }
            disabled={!editable || update.isPending}
          />
        </SettingsRow>
        <SettingsRow label={t('journalExport')} hint={t('journalExportHint')}>
          {hasRoleAtLeast(role, 'tech') ? (
            <Button
              variant="outline"
              render={<Link href={`/settings?project=${encodeURIComponent(id)}&section=journal`} />}
              nativeButton={false}
            >
              {t('openJournal')}
            </Button>
          ) : (
            <Button variant="outline" disabled>
              {t('openJournal')}
            </Button>
          )}
        </SettingsRow>
      </SettingsCard>

      <SettingsCard title={t('data')}>
        <SettingsRow label={t('dataExport')} hint={t('dataExportHint')}>
          <Button variant="outline" disabled>
            {t('export')}
          </Button>
        </SettingsRow>
        <SettingsRow label={t('clientRetention')} hint={t('clientRetentionHint')} htmlFor="security-clients">
          <OptionSelect<number>
            id="security-clients"
            value={project.clientDataRetentionDays}
            options={CLIENT_DATA_RETENTION_DAYS}
            label={(count) => options('days', { count })}
            onChange={(clientDataRetentionDays) =>
              update.mutate({ clientDataRetentionDays }, { onError: reportError })
            }
            disabled={!editable || update.isPending}
          />
        </SettingsRow>
      </SettingsCard>

      <SettingsCard title={t('danger')}>
        <SettingsRow
          label={t('teamPause')}
          hint={
            project.pausedUntil
              ? t('pausedUntil', {
                  time: format.dateTime(new Date(project.pausedUntil), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }),
                })
              : t(project.agentsPaused ? 'paused' : 'teamPauseHint')
          }
        >
          <Button
            variant="outline"
            disabled={!editable || busy}
            onClick={() => {
              if (project.agentsPaused) resume.mutate(undefined, { onError: reportError });
              else setPausing(true);
            }}
          >
            {t(project.agentsPaused ? 'resume' : 'pause')}
          </Button>
        </SettingsRow>
        <SettingsRow label={t('disconnect')} hint={t('disconnectHint')}>
          <Button
            variant="outline"
            className="text-destructive"
            disabled={!editable || busy}
            onClick={() => void disconnectAll()}
          >
            {t('disconnectButton')}
          </Button>
        </SettingsRow>
        <SettingsRow label={t('delete')} hint={role === 'owner' ? t('deleteHint') : t('ownerOnly')}>
          <Button
            variant="outline"
            className="text-destructive"
            disabled={role !== 'owner' || busy}
            onClick={() => void deleteProject()}
          >
            {t('deleteButton')}
          </Button>
        </SettingsRow>
      </SettingsCard>

      <Dialog
        open={pausing}
        onOpenChange={(open) => {
          if (!busy) {
            setPausing(open);
            if (!open) setUntil('');
          }
        }}
      >
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const date = until ? new Date(until) : undefined;
              if (date && !(date.getTime() > Date.now())) {
                toast.error(t('pauseFuture'));
                return;
              }
              pause.mutate(date, {
                onSuccess: () => {
                  setUntil('');
                  setPausing(false);
                },
                onError: reportError,
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('teamPause')}</DialogTitle>
              <DialogDescription>{t('pauseHint')}</DialogDescription>
            </DialogHeader>
            <label className="grid gap-2 text-sm font-medium">
              {t('pauseUntil')}
              <Input
                type="datetime-local"
                value={until}
                disabled={busy}
                onChange={(event) => setUntil(event.target.value)}
              />
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setUntil('');
                  setPausing(false);
                }}
              >
                {common('cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {t('pause')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
