import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { GuestOnly } from '@/core/auth/guest-only';
import { SignupForm } from '@/features/auth';
import { AuthLayout } from '@/widgets/auth-layout';

export default async function SignupPage() {
  const t = await getTranslations('auth.signup');
  return (
    <AuthLayout title={t('title')} subtitle={t('subtitle')}>
      <Suspense>
        <GuestOnly>
          <SignupForm />
        </GuestOnly>
      </Suspense>
    </AuthLayout>
  );
}
