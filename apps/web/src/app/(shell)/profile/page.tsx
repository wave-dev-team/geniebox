'use client';

import { useTranslations } from 'next-intl';

import { Avatar, AvatarFallback } from '@workspace/ui/components/avatar';
import { Skeleton } from '@workspace/ui/components/skeleton';

import { useMe } from '@/entities/session';
import { useWorkspaces } from '@/entities/workspace';
import { ProfileForm } from '@/features/profile-edit';
import { initials } from '@/shared/lib/initials';
import { SettingsCard } from '@/shared/ui/settings-card';

/** Profile (H07). Photo upload arrives with file storage; until then initials are shown. */
export default function ProfilePage() {
  const t = useTranslations('profile');
  const tWorkspace = useTranslations('workspace');
  const me = useMe();
  const { data: directory } = useWorkspaces();
  const active = directory?.workspaces.find(({ id }) => id === directory.activeId);

  if (!me.data) {
    return <Skeleton className="h-96 rounded-xl" />;
  }
  const name = me.data.name;
  const membership = active ? `${tWorkspace(active.role)} · ${active.name}` : me.data.email;

  return (
    <>
      <SettingsCard title={t('account')}>
        <div className="flex items-center gap-4 px-5 py-4">
          <Avatar className="size-14 rounded-xl">
            <AvatarFallback className="rounded-xl text-base">{initials(name)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{name}</span>
            <span className="truncate text-sm text-muted-foreground">{membership}</span>
          </div>
        </div>
      </SettingsCard>
      <ProfileForm profile={me.data} />
    </>
  );
}
