import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { GuestOnly } from '@/core/auth/guest-only';
import { LoginForm } from '@/features/auth';
import { AuthLayout } from '@/widgets/auth-layout';

export default async function LoginPage() {
  const t = await getTranslations('auth');
  return (
    <AuthLayout title={t('login.title')} subtitle={t('tagline')}>
      <Suspense>
        <GuestOnly>
          <LoginForm />
        </GuestOnly>
      </Suspense>
    </AuthLayout>
  );
}
