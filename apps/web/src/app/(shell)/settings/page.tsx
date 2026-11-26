'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@workspace/ui/components/button';
import { Input } from '@workspace/ui/components/input';
import { Skeleton } from '@workspace/ui/components/skeleton';

import { useMe } from '@/entities/session';
import { useWorkspaces } from '@/entities/workspace';
import { accountsApi } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { SettingsCard, SettingsRow } from '@/shared/ui/settings-card';

export default function SettingsPage() {
  const t = useTranslations('workspace');
  const me = useMe();
  const directory = useWorkspaces();
  const active = directory.data?.workspaces.find(({ id }) => id === directory.data?.activeId);
  const client = useQueryClient();
  const errorMessage = useErrorMessage();
  const onError = (error: Error) => toast.error(errorMessage(error));

  const members = useQuery({
    queryKey: ['workspace-members', active?.id, me.data?.id],
    enabled: Boolean(active),
    queryFn: ({ signal }) => accountsApi.members(signal),
  });
  const rename = useMutation({
    mutationFn: accountsApi.rename,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['workspaces'] });
      toast.success(t('saved'));
    },
    onError,
  });
  const invite = useMutation({
    mutationFn: accountsApi.invite,
    onSuccess: () => toast.success(t('sent')),
    onError,
  });
  const join = useMutation({
    mutationFn: accountsApi.join,
    onSuccess: () => window.location.reload(),
    onError,
  });

  if (!active || !me.data) {
    return (
      <main className="mx-auto w-full max-w-200 px-6 py-10">
        {directory.isError ? (
          <Button onClick={() => void directory.refetch()} variant="outline">
            {t('retry')}
          </Button>
        ) : (
          <Skeleton className="h-60" />
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-200 flex-col gap-6 px-6 py-10">
      <h1 className="text-xl font-semibold">{t('settings')}</h1>
      <SettingsCard title={active.name}>
        {active.role === 'owner' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = new FormData(event.currentTarget).get('name');
              if (typeof name === 'string' && name.trim() && name.trim() !== active.name) rename.mutate(name);
            }}
          >
            <SettingsRow htmlFor="workspace-name" label={t('name')}>
              <Input id="workspace-name" name="name" defaultValue={active.name} maxLength={120} required />
              <Button type="submit" disabled={rename.isPending}>
                {t('save')}
              </Button>
            </SettingsRow>
          </form>
        ) : null}
        <div className="border-t">
          <SettingsRow label={t('members')}>
            {members.isPending ? (
              <Skeleton className="h-7 w-28" />
            ) : members.isError ? (
              <Button variant="outline" onClick={() => void members.refetch()}>
                {t('retry')}
              </Button>
            ) : (
              <ul className="flex min-w-0 flex-col gap-2">
                {members.data?.map((member) => (
                  <li key={member.id} className="break-words text-sm">
                    {member.name} <span className="text-muted-foreground">· {t(member.role)}</span>
                  </li>
                ))}
              </ul>
            )}
          </SettingsRow>
        </div>
        {active.role === 'owner' ? (
          <form
            className="border-t"
            onSubmit={(event) => {
              event.preventDefault();
              const email = new FormData(event.currentTarget).get('email');
              if (typeof email === 'string') invite.mutate(email);
            }}
          >
            <SettingsRow
              htmlFor="workspace-invite"
              label={t('invite')}
              hint={!me.data.emailVerified ? t('verifyFirst') : undefined}
            >
              <Input
                id="workspace-invite"
                name="email"
                type="email"
                autoComplete="email"
                disabled={!me.data.emailVerified}
                required
              />
              <Button type="submit" disabled={invite.isPending || !me.data.emailVerified}>
                {t('send')}
              </Button>
            </SettingsRow>
          </form>
        ) : null}
      </SettingsCard>
      <SettingsCard title={t('join')}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const code = new FormData(event.currentTarget).get('code');
            if (typeof code === 'string') join.mutate(code);
          }}
        >
          <SettingsRow
            htmlFor="workspace-code"
            label={t('code')}
            hint={me.data.emailVerified ? t('codeHelp') : t('verifyFirst')}
          >
            <Input
              id="workspace-code"
              name="code"
              autoComplete="off"
              spellCheck={false}
              disabled={!me.data.emailVerified}
              required
            />
            <Button type="submit" disabled={join.isPending || !me.data.emailVerified}>
              {t('joinAction')}
            </Button>
          </SettingsRow>
        </form>
      </SettingsCard>
    </main>
  );
}
