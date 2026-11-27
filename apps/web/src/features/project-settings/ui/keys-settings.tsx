'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
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
import { cn } from '@workspace/ui/lib/utils';

import { projectConnectionsKey, type ProjectRef, useProjectConnections } from '@/entities/project/operations';
import { listConnectionProviders, projectOperations } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { SettingsQueryStatus } from '@/shared/ui/settings-query-status';

export function KeysSettings({ project }: { project: ProjectRef }) {
  const t = useTranslations('projectSettings');
  const format = useFormatter();
  const connections = useProjectConnections(project);
  const [rotating, setRotating] = useState<ProjectConnection>();
  const keys = (connections.data ?? []).flatMap((connection) =>
    connection.credential ? [{ connection, key: connection.credential }] : [],
  );

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <h2 className="font-semibold">{t('tabs.keys')}</h2>
        <p className="text-sm text-muted-foreground">{t('keysDescription')}</p>
      </header>
      {connections.isPending || connections.isError ? (
        <SettingsQueryStatus query={connections} />
      ) : !keys.length ? (
        <p className="rounded-xl border px-5 py-4 text-sm text-muted-foreground">{t('noKeys')}</p>
      ) : (
        <ul className="flex flex-col gap-2 rounded-xl border p-3">
          {keys.map(({ connection, key }) => (
            <li
              key={connection.id}
              className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-lg bg-muted/40 px-4 py-3 lg:grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1fr)_auto_auto]"
            >
              <span className="rounded-lg bg-muted p-2 text-muted-foreground">
                <KeyRound className="size-4" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{connection.name}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {connection.providerKey}
                </span>
              </span>
              <span className="col-start-2 flex min-w-0 flex-col lg:col-start-auto">
                <code className="truncate text-xs">{key.masked}</code>
                <span className="text-xs text-muted-foreground">
                  {key.expiresAt
                    ? t('keyExpires', {
                        date: format.dateTime(new Date(key.expiresAt), { dateStyle: 'medium' }),
                      })
                    : t('keyUpdated', {
                        date: format.dateTime(new Date(key.updatedAt), { dateStyle: 'medium' }),
                      })}
                </span>
              </span>
              <span
                className={cn(
                  'col-start-2 flex items-center gap-1.5 text-sm lg:col-start-auto',
                  key.health !== 'ok' && 'text-destructive',
                )}
              >
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    key.health === 'ok' ? 'bg-chart-2' : 'bg-destructive',
                  )}
                />
                {t(`keyHealth.${key.health}`)}
              </span>
              <Button
                className="col-start-2 justify-self-start lg:col-start-auto"
                variant="outline"
                onClick={() => setRotating(connection)}
              >
                {t('rotate')}
              </Button>
              {connection.config.public_key && (
                <code className="col-start-2 col-end-[-1] break-all text-xs text-muted-foreground">
                  {connection.config.public_key}
                </code>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">{t('keysNote')}</p>
      {rotating && (
        <RotateKey project={project} connection={rotating} onClose={() => setRotating(undefined)} />
      )}
    </section>
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
