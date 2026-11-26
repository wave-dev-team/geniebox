'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@workspace/ui/components/button';

import { useMe } from '@/entities/session';
import { useNextPath, VerifyEmailForm } from '@/features/auth';
import { routes } from '@/shared/config/routes';
import { AuthLayout } from '@/widgets/auth-layout';

export function VerifyEmailScreen() {
  const t = useTranslations('auth.verify');
  const router = useRouter();
  const next = useNextPath() ?? routes.root();
  const me = useMe();

  React.useEffect(() => {
    if (me.data?.emailVerified) {
      router.replace(next);
    }
  }, [me.data?.emailVerified, next, router]);

  return (
    <AuthLayout title={t('title')} subtitle={t('subtitle', { email: me.data?.email ?? '…' })}>
      <VerifyEmailForm onVerified={() => router.replace(next)} />
      <Button variant="ghost" onClick={() => router.replace(next)}>
        {t('later')}
      </Button>
    </AuthLayout>
  );
}
