'use client';

import { useFormatter, useNow, useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@workspace/ui/components/button';
import { Skeleton } from '@workspace/ui/components/skeleton';

import { useMe } from '@/entities/session';
import { SessionsCard } from '@/features/manage-sessions';
import { ChangePasswordDialog } from '@/features/password-change';
import { SettingsCard, SettingsRow } from '@/shared/ui/settings-card';

/** Sign-in and security (H09). Two-factor sign-in is not offered by the backend yet. */
export default function SecurityPage() {
  const t = useTranslations('profile.security');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const me = useMe();
  const [dialog, setDialog] = React.useState(false);

  if (!me.data) {
    return <Skeleton className="h-64 rounded-xl" />;
  }
  const { hasPassword, passwordChangedAt } = me.data;

  return (
    <>
      <SettingsCard title={t('signIn')}>
        <SettingsRow
          label={t('password')}
          hint={
            hasPassword
              ? passwordChangedAt
                ? t('passwordChanged', {
                    when: format.relativeTime(new Date(passwordChangedAt), now),
                  })
                : null
              : t('passwordNotSet')
          }
        >
          <Button variant="outline" onClick={() => setDialog(true)}>
            {hasPassword ? t('change') : t('set')}
          </Button>
        </SettingsRow>
      </SettingsCard>
      <SessionsCard />
      <ChangePasswordDialog hasPassword={hasPassword} open={dialog} onOpenChange={setDialog} />
    </>
  );
}
