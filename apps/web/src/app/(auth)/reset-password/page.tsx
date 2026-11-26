import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { ResetPasswordForm } from '@/features/auth';
import { AuthLayout } from '@/widgets/auth-layout';

export default async function ResetPasswordPage() {
  const t = await getTranslations('auth.reset');
  return (
    <AuthLayout title={t('title')} subtitle={t('subtitle')}>
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </AuthLayout>
  );
}
