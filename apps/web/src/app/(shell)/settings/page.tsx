'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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
  const router = useRouter();
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
        <SettingForm
          label={t('newProject')}
          action={t('create')}
          submit={async (form) => {
            const project = await accountsApi.createProject(active.id, String(form.get('name')).trim());
            sessionStorage.setItem(`geniebox:project:${active.id}`, project.id);
            await client.invalidateQueries({ queryKey: ['projects', active.id] });
            router.push('/chat');
          }}
        >
          <Input
            aria-label={t('projectName')}
            name="name"
            placeholder={t('projectName')}
            maxLength={120}
            required
          />
        </SettingForm>
      )}
    </SettingsCard>
  );
}

function Settings() {
  const t = useTranslations('workspace');
  const router = useRouter();
  const invite = useSearchParams().get('invite') ?? '';
  const me = useMe();
  const directory = useWorkspaces();
  const [creating, setCreating] = useState(false);
  const accountSettings = (
    <>
      {directory.active && <AccountSettings key={directory.active.id} active={directory.active} />}
      <SettingsCard title={t('accounts')}>
        <SettingsRow label={t('newAccount')}>
          <Button onClick={() => setCreating(true)}>{t('create')}</Button>
        </SettingsRow>
        {creating && <CreateAccountDialog onClose={() => setCreating(false)} />}
        <SettingForm
          label={t('join')}
          action={t('joinAction')}
          disabled={!me.data?.emailVerified}
          submit={async (form) => {
            const account = await accountsApi.join(String(form.get('token')).trim());
            directory.activate(account);
            router.replace('/chat');
          }}
        >
          <Input
            aria-label={t('code')}
            placeholder={t('code')}
            name="token"
            defaultValue={invite}
            required
            minLength={20}
            maxLength={100}
          />
          {!me.data?.emailVerified && (
            <Link
              className="text-sm underline"
              href={routes.verifyEmail('/settings' + (invite ? '?invite=' + encodeURIComponent(invite) : ''))}
            >
              {t('verifyFirst')}
            </Link>
          )}
        </SettingForm>
      </SettingsCard>
    </>
  );

  if (directory.active && !invite) {
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
      {(!directory.isPending || invite) && accountSettings}
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
