'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, Suspense, useState } from 'react';
import { toast } from 'sonner';

import type { Workspace } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import { Input } from '@workspace/ui/components/input';
import { Skeleton } from '@workspace/ui/components/skeleton';

import { useMe } from '@/entities/session';
import { localAccountDescription, useWorkspaces } from '@/entities/workspace';
import { CreateAccountDialog } from '@/features/create-account/ui/create-account-dialog';
import { accountsApi } from '@/shared/api';
import { routes } from '@/shared/config/routes';
import { useErrorMessage } from '@/shared/lib/api-error';
import { useConfirm } from '@/shared/ui/confirm-dialog';
import { SettingsCard, SettingsRow } from '@/shared/ui/settings-card';
import { ProjectSettings } from '@/widgets/project-settings/ui/project-settings';
import { SectionLayout } from '@/widgets/section-layout';

function SettingForm({
  label,
  action,
  submit,
  children,
  disabled,
}: {
  label: string;
  action: string;
  submit: (value: FormData) => Promise<void>;
  children: ReactNode;
  disabled?: boolean;
}) {
  const errorMessage = useErrorMessage();
  const mutation = useMutation({ mutationFn: submit });
  return (
    <form
      className="border-t first:border-0"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        mutation.mutate(new FormData(form), { onSuccess: () => form.reset() });
      }}
    >
      <SettingsRow label={label}>
        {children}
        <Button type="submit" disabled={disabled || mutation.isPending}>
          {action}
        </Button>
        {mutation.error && (
          <span role="alert" className="text-sm text-destructive">
            {errorMessage(mutation.error)}
          </span>
        )}
      </SettingsRow>
    </form>
  );
}

function AccountSettings({ active }: { active: Workspace }) {
  const t = useTranslations('workspace');
  const client = useQueryClient();
  const { data: me } = useMe();
  const description = localAccountDescription(me?.id, active.id);
  const manager = active.role === 'owner' || active.role === 'admin';
  return (
    <SettingsCard title={active.name} description={description ?? undefined}>
      {manager && (
        <SettingForm
          label={t('name')}
          action={t('save')}
          submit={async (form) => {
            await accountsApi.rename(active.id, String(form.get('name')).trim());
            await client.invalidateQueries({ queryKey: ['workspaces'] });
            toast.success(t('saved'));
          }}
        >
          <Input aria-label={t('name')} name="name" defaultValue={active.name} maxLength={200} required />
        </SettingForm>
      )}
      {manager && (
        <SettingsRow label={t('newProject')}>
          <Button render={<Link href={routes.onboarding()} />} nativeButton={false}>
            {t('create')}
          </Button>
        </SettingsRow>
      )}
    </SettingsCard>
  );
}

function ManagerContextSettings({ account }: { account: Workspace }) {
  const t = useTranslations('managerContextSettings');
  const client = useQueryClient();
  const errorMessage = useErrorMessage();
  const confirm = useConfirm();
  const reset = useMutation({
    mutationFn: (scope: 'personal' | 'account') => accountsApi.resetManagerContext(account.id, scope),
    onSuccess: async (_response, scope) => {
      await client.resetQueries({ queryKey: ['chat', account.id] });
      toast.success(t(`${scope}.success`));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const resetContext = async (scope: 'personal' | 'account') => {
    if (
      await confirm({
        title: t(`${scope}.action`),
        description: t(`${scope}.confirm`),
        confirmLabel: t('confirmAction'),
      })
    )
      reset.mutate(scope);
  };

  return (
    <SettingsCard title={t('title')} description={t('description')}>
      <SettingsRow label={t('personal.title')} hint={t('personal.hint')}>
        <Button variant="outline" disabled={reset.isPending} onClick={() => void resetContext('personal')}>
          {t('personal.action')}
        </Button>
      </SettingsRow>
      {account.role === 'owner' && (
        <SettingsRow label={t('account.title')} hint={t('account.hint')}>
          <Button
            variant="outline"
            className="text-destructive"
            disabled={reset.isPending}
            onClick={() => void resetContext('account')}
          >
            {t('account.action')}
          </Button>
        </SettingsRow>
      )}
    </SettingsCard>
  );
}

function Settings() {
  const t = useTranslations('workspace');
  const directory = useWorkspaces();
  const [creating, setCreating] = useState(false);
  const accountSettings = (
    <>
      {directory.active && (
        <>
          <AccountSettings key={directory.active.id} active={directory.active} />
          <ManagerContextSettings key={`context-${directory.active.id}`} account={directory.active} />
        </>
      )}
      <SettingsCard title={t('accounts')}>
        <SettingsRow label={t('newAccount')}>
          <Button onClick={() => setCreating(true)}>{t('create')}</Button>
        </SettingsRow>
        {creating && <CreateAccountDialog onClose={() => setCreating(false)} />}
        <SettingsRow label={t('join')}>
          <Button variant="outline" render={<Link href={routes.invitation()} />} nativeButton={false}>
            {t('joinAction')}
          </Button>
        </SettingsRow>
      </SettingsCard>
    </>
  );

  if (directory.active) {
    return (
      <ProjectSettings
        key={directory.active.id}
        account={directory.active}
        accountSettings={accountSettings}
      />
    );
  }

  return (
    <SectionLayout title={t('settings')} nav={[]}>
      {directory.isError && (
        <Button variant="outline" onClick={() => void directory.refetch()}>
          {t('retry')}
        </Button>
      )}
      {directory.isPending && <Skeleton className="h-36" />}
      {!directory.isPending && accountSettings}
    </SectionLayout>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <Settings />
    </Suspense>
  );
}
