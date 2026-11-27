'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import type { MetricKey } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import { Input } from '@workspace/ui/components/input';
import { Skeleton } from '@workspace/ui/components/skeleton';

import { useMe } from '@/entities/session';
import { useWorkspaces } from '@/entities/workspace';
import { metricsApi } from '@/shared/api';
import { businessApiAvailable } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { SettingsCard, SettingsRow } from '@/shared/ui/settings-card';

export default function MetricsPage() {
  const t = useTranslations('analytics');
  const unavailable = useTranslations('app')('businessUnavailable');
  const { data: me } = useMe();
  const { data: workspaces } = useWorkspaces();
  const owner = workspaces?.workspaces.find(({ id }) => id === workspaces.activeId)?.role === 'owner';
  const client = useQueryClient();
  const errorMessage = useErrorMessage();
  const key = ['metric-definitions', workspaces?.activeId, me?.id];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => metricsApi.list(signal),
    enabled: businessApiAvailable && Boolean(me),
  });
  const save = useMutation({
    mutationFn: ({ metric, label }: { metric: MetricKey; label: string }) => metricsApi.rename(metric, label),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key });
      toast.success(t('metricSaved'));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <main className="mx-auto flex w-full max-w-200 flex-col gap-6 px-6 py-10">
      <h1 className="text-xl font-semibold">{t('metrics')}</h1>
      {!businessApiAvailable && <p className="text-sm text-muted-foreground">{unavailable}</p>}
      {query.isLoading ? (
        <Skeleton className="h-40" />
      ) : query.isError ? (
        <Button className="self-start" variant="outline" onClick={() => void query.refetch()}>
          {t('retry')}
        </Button>
      ) : (
        <SettingsCard title={t('metricSource')}>
          {query.data?.map(({ key: metric, label }) => (
            <form
              className="border-b last:border-b-0"
              key={metric}
              onSubmit={(event) => {
                event.preventDefault();
                const value = new FormData(event.currentTarget).get('label');
                if (typeof value === 'string' && value.trim()) save.mutate({ metric, label: value });
              }}
            >
              <SettingsRow label={t(metric)} htmlFor={`metric-${metric}`}>
                {owner ? (
                  <>
                    <Input
                      id={`metric-${metric}`}
                      name="label"
                      defaultValue={label === metric ? t(metric) : label}
                      maxLength={120}
                      required
                    />
                    <Button type="submit" disabled={save.isPending}>
                      {t('save')}
                    </Button>
                  </>
                ) : (
                  <span className="text-sm">{label === metric ? t(metric) : label}</span>
                )}
              </SettingsRow>
            </form>
          ))}
        </SettingsCard>
      )}
    </main>
  );
}
