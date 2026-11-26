'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import type { MetricaConnectionInput } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import { Input } from '@workspace/ui/components/input';
import { Skeleton } from '@workspace/ui/components/skeleton';

import { useMe } from '@/entities/session';
import { useWorkspaces } from '@/entities/workspace';
import { connectionsApi } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { SettingsCard, SettingsRow } from '@/shared/ui/settings-card';

export default function ConnectionsPage() {
  const t = useTranslations('connectionSetup');
  const { data: me } = useMe();
  const { data: workspaces } = useWorkspaces();
  const owner = workspaces?.workspaces.find(({ id }) => id === workspaces.activeId)?.role === 'owner';
  const client = useQueryClient();
  const errorMessage = useErrorMessage();
  const key = ['connections', me?.tenantId, me?.id] as const;
  const [editing, setEditing] = useState(false);
  const data = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => connectionsApi.list(signal),
    enabled: Boolean(me),
  });
  const save = useMutation({
    mutationFn: connectionsApi.save,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key });
      setEditing(false);
      toast.success(t('saved'));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: connectionsApi.remove,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key });
      setEditing(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const metrica = data.data?.metrica;
  const busy = save.isPending || remove.isPending;

  return (
    <main className="mx-auto flex w-full max-w-200 flex-col gap-6 px-6 py-10">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      {data.isPending ? (
        <Skeleton className="h-40" />
      ) : data.isError ? (
        <Button className="self-start" variant="outline" onClick={() => void data.refetch()}>
          {t('retry')}
        </Button>
      ) : (
        <SettingsCard
          title={t('metrica')}
          description={metrica?.mode === 'demo' ? t('demoDescription') : undefined}
        >
          <SettingsRow label={t('status')}>
            <span className="text-sm text-muted-foreground">{t(metrica?.mode ?? 'disconnected')}</span>
          </SettingsRow>
          {metrica?.counterId ? (
            <SettingsRow label={t('counter')}>
              <span className="text-sm">{metrica.counterId}</span>
            </SettingsRow>
          ) : null}
          {owner ? (
            <div className="border-t">
              <div className="flex flex-wrap gap-2 px-5 py-4">
                {data.data.liveAvailable ? (
                  <Button variant="outline" disabled={busy} onClick={() => setEditing(!editing)}>
                    {t(editing ? 'close' : 'configure')}
                  </Button>
                ) : (
                  <span className="self-center text-sm text-muted-foreground">{t('liveUnavailable')}</span>
                )}
                {metrica?.mode !== 'demo' ? (
                  <Button variant="outline" disabled={busy} onClick={() => save.mutate({ mode: 'demo' })}>
                    {t('useDemo')}
                  </Button>
                ) : null}
                {metrica ? (
                  <Button variant="ghost" disabled={busy} onClick={() => remove.mutate()}>
                    {t('remove')}
                  </Button>
                ) : null}
              </div>
              {editing && data.data.liveAvailable ? (
                <form
                  className="border-t"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const input: MetricaConnectionInput = {
                      mode: 'live',
                      counterId: String(form.get('counterId')),
                      token: String(form.get('token')),
                    };
                    save.mutate(input);
                  }}
                >
                  <SettingsRow htmlFor="metrica-counter" label={t('counter')}>
                    <Input
                      id="metrica-counter"
                      name="counterId"
                      inputMode="numeric"
                      pattern="[1-9][0-9]{0,14}"
                      defaultValue={metrica?.counterId ?? ''}
                      required
                    />
                  </SettingsRow>
                  <SettingsRow htmlFor="metrica-token" label={t('token')}>
                    <Input
                      id="metrica-token"
                      name="token"
                      type="password"
                      autoComplete="off"
                      minLength={12}
                      maxLength={512}
                      required
                    />
                  </SettingsRow>
                  <div className="px-5 py-4">
                    <Button disabled={busy} type="submit">
                      {t('connect')}
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
          ) : null}
        </SettingsCard>
      )}
    </main>
  );
}
