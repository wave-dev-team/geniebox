'use client';

import { useTranslations } from 'next-intl';

import { Avatar, AvatarFallback } from '@workspace/ui/components/avatar';
import { Skeleton } from '@workspace/ui/components/skeleton';

import { useMe } from '@/entities/session';
import { ProfileForm } from '@/features/profile-edit';
import { initials } from '@/shared/lib/initials';
import { SettingsCard } from '@/shared/ui/settings-card';

/** Profile (H07). Photo upload arrives with file storage; until then initials are shown. */
export default function ProfilePage() {
  const t = useTranslations('profile');
  const tRoles = useTranslations('roles');
  const tApp = useTranslations('app');
  const me = useMe();

  if (!me.data) {
    return <Skeleton className="h-96 rounded-xl" />;
  }
  const name = me.data.name;
  const memberships = `${tRoles('owner')} · ${tApp('brand')}`;

  return (
    <>
      <SettingsCard title={t('account')}>
        <div className="flex items-center gap-4 px-5 py-4">
          <Avatar className="size-14 rounded-xl">
            <AvatarFallback className="rounded-xl text-base">{initials(name)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{name}</span>
            <span className="truncate text-sm text-muted-foreground">{memberships || me.data.email}</span>
          </div>
        </div>
      </SettingsCard>
      <ProfileForm profile={me.data} />
    </>
  );
}
