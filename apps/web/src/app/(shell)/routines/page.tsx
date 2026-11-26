'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { createRoutineSchema } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import { Input } from '@workspace/ui/components/input';
import { Skeleton } from '@workspace/ui/components/skeleton';

import { useMe } from '@/entities/session';
import { routinesApi } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { SettingsCard, SettingsRow } from '@/shared/ui/settings-card';

export default function RoutinesPage() {
  const t = useTranslations('routines');
  const format = useFormatter();
  const router = useRouter();
  const { data: me } = useMe();
  const scope = [me?.tenantId, me?.id] as const;
  const key = ['routines', ...scope] as const;
  const client = useQueryClient();
  const errorMessage = useErrorMessage();
  const onError = (error: Error) => toast.error(errorMessage(error));

  const routines = useQuery({
    queryKey: key,
    enabled: Boolean(me),
    queryFn: ({ signal }) => routinesApi.list(signal),
  });
  const create = useMutation({
    mutationFn: routinesApi.create,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key });
      toast.success(t('created'));
    },
    onError,
  });
  const enable = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => routinesApi.enable(id, enabled),
    onSuccess: () => void client.invalidateQueries({ queryKey: key }),
    onError,
  });
  const run = useMutation({
    mutationFn: (id: string) => routinesApi.run(id, crypto.randomUUID()),
    onSuccess: ({ taskId }) => {
      void client.invalidateQueries({ queryKey: ['tasks', ...scope] });
      router.push(`/tasks?task=${taskId}`);
    },
    onError,
  });

  return (
    <main className="mx-auto flex w-full max-w-200 flex-col gap-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Link className="text-sm underline underline-offset-4" href="/tasks">
          {t('tasks')}
        </Link>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const input = createRoutineSchema.safeParse({
            id: crypto.randomUUID(),
            title: form.get('title'),
            description: form.get('description'),
            cadence: form.get('cadence'),
          });
          if (!input.success) {
            toast.error(t('invalid'));
            return;
          }
          const element = event.currentTarget;
          create.mutate(input.data, { onSuccess: () => element.reset() });
        }}
      >
        <SettingsCard
          title={t('new')}
          description={t('scheduleHelp')}
          footer={
            <Button type="submit" disabled={create.isPending}>
              {t('save')}
            </Button>
          }
        >
          <SettingsRow htmlFor="routine-title" label={t('name')}>
            <Input id="routine-title" name="title" maxLength={160} required />
          </SettingsRow>
          <SettingsRow htmlFor="routine-description" label={t('description')}>
            <Input id="routine-description" name="description" maxLength={4000} />
          </SettingsRow>
          <SettingsRow htmlFor="routine-cadence" label={t('cadence')}>
            <select
              id="routine-cadence"
              name="cadence"
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="daily">{t('daily')}</option>
              <option value="weekly">{t('weekly')}</option>
            </select>
          </SettingsRow>
        </SettingsCard>
      </form>
      {routines.isPending ? (
        <Skeleton className="h-28" />
      ) : routines.isError ? (
        <Button className="self-start" variant="outline" onClick={() => void routines.refetch()}>
          {t('retry')}
        </Button>
      ) : routines.data.length ? (
        <SettingsCard title={t('saved')}>
          {routines.data.map((routine) => (
            <SettingsRow
              key={routine.id}
              label={routine.title}
              hint={
                routine.enabled
                  ? t('next', {
                      when: format.dateTime(new Date(routine.nextRunAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })
                  : t('paused')
              }
            >
              <Button variant="outline" disabled={run.isPending} onClick={() => run.mutate(routine.id)}>
                {t('run')}
              </Button>
              <Button
                variant="ghost"
                disabled={enable.isPending}
                onClick={() => enable.mutate({ id: routine.id, enabled: !routine.enabled })}
              >
                {t(routine.enabled ? 'pause' : 'resume')}
              </Button>
            </SettingsRow>
          ))}
        </SettingsCard>
      ) : (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      )}
    </main>
  );
}
