'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import type { ProjectConnection } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog';
import { Input } from '@workspace/ui/components/input';

import { projectConnectionsKey, type ProjectRef, useProjectConnections } from '@/entities/project/operations';
import { listConnectionProviders, projectOperations } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { SettingsCard, SettingsRow } from '@/shared/ui/settings-card';
import { SettingsQueryStatus } from '@/shared/ui/settings-query-status';

export function KeysSettings({ project }: { project: ProjectRef }) {
  const t = useTranslations('projectSettings');
  const format = useFormatter();
  const connections = useProjectConnections(project);
  const [rotating, setRotating] = useState<ProjectConnection>();
  const keys = connections.data?.filter(({ credential }) => credential);

  return (
    <SettingsCard title={t('tabs.keys')}>
      {connections.isPending || connections.isError ? (
        <SettingsQueryStatus query={connections} />
      ) : (
        <>
          {!keys?.length && <p className="p-5 text-sm text-muted-foreground">{t('noKeys')}</p>}
          {keys?.map((connection) => {
            const key = connection.credential!;
            return (
              <SettingsRow
                key={connection.id}
                label={connection.name}
                hint={
                  <span className="grid gap-1">
                    <code>{key.masked}</code>
                    <span>
                      {t(`keyHealth.${key.health}`)} ·{' '}
                      {key.expiresAt
                        ? t('keyExpires', {
                            date: format.dateTime(new Date(key.expiresAt), { dateStyle: 'medium' }),
                          })
                        : t('keyUpdated', {
                            date: format.dateTime(new Date(key.updatedAt), { dateStyle: 'medium' }),
                          })}
                    </span>
                    {connection.config.public_key && (
                      <code className="break-all text-xs">{connection.config.public_key}</code>
                    )}
                  </span>
                }
              >
                <Button variant="outline" onClick={() => setRotating(connection)}>
                  {t('rotate')}
                </Button>
              </SettingsRow>
            );
          })}
        </>
      )}
      {rotating && (
        <RotateKey project={project} connection={rotating} onClose={() => setRotating(undefined)} />
      )}
    </SettingsCard>
  );
}

function RotateKey({
  project,
  connection,
  onClose,
}: {
  project: ProjectRef;
  connection: ProjectConnection;
  onClose: () => void;
}) {
  const t = useTranslations('projectSettings');
  const common = useTranslations('common');
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const [typed, setTyped] = useState('');
  const providers = useQuery({
    queryKey: ['connection-providers'],
    queryFn: ({ signal }) => listConnectionProviders(signal),
  });
  const provider = providers.data?.find(({ key }) => key === connection.providerKey);
  const fields = provider?.fields.filter(({ kind }) => kind === 'secret') ?? [];
  const rotate = useMutation({
    gcTime: 0,
    mutationFn: (fields?: Record<string, string>) =>
      projectOperations(project.accountId, project.id).rotate(connection.id, fields),
    onSuccess: ({ check }) => {
      void client.invalidateQueries({ queryKey: projectConnectionsKey(project) });
      if (provider?.sshKey) toast.info(t('installSsh'));
      else if (check?.status === 'error') toast.warning(t('keyCheckFailed'));
      else toast.success(t('rotated'));
      onClose();
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !rotate.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('rotateTitle', { name: connection.name })}</DialogTitle>
          <DialogDescription>{provider?.sshKey ? t('rotateSsh') : t('rotateExternal')}</DialogDescription>
        </DialogHeader>
        {providers.isPending || providers.isError ? (
          <SettingsQueryStatus query={providers} />
        ) : !provider ? (
          <p className="text-sm text-destructive">{t('providerMissing')}</p>
        ) : (
          <form
            className="grid gap-4"
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              if (rotate.isPending) return;
              const data = new FormData(event.currentTarget);
              rotate.mutate(
                provider.sshKey
                  ? undefined
                  : Object.fromEntries(
                      fields
                        .map(({ key }) => [key, String(data.get(key) ?? '').trim()])
                        .filter(([, value]) => value),
                    ),
              );
            }}
          >
            {provider.sshKey ? (
              <label className="grid gap-1 text-sm">
                {common.rich('confirmPrompt', {
                  word: common('confirmWord'),
                  b: (text) => <strong>{text}</strong>,
                })}
                <Input
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  disabled={rotate.isPending}
                  required
                />
              </label>
            ) : (
              fields.map(({ key, required }) => (
                <label key={key} className="grid gap-1 text-sm">
                  {key}
                  <Input name={key} type="password" required={required} disabled={rotate.isPending} />
                </label>
              ))
            )}
            {rotate.error && (
              <p className="text-sm text-destructive" role="alert">
                {errorMessage(rotate.error)}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={rotate.isPending} onClick={onClose}>
                {common('cancel')}
              </Button>
              <Button
                type="submit"
                disabled={rotate.isPending || (provider.sshKey && typed.trim() !== common('confirmWord'))}
              >
                {t('rotate')}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
