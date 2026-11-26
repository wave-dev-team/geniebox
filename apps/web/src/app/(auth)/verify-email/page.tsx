import { Suspense } from 'react';

import { VerifyEmailScreen } from './verify-email-screen';

import { RequireAuth } from '@/core/auth/auth-gate';

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <RequireAuth>
        <VerifyEmailScreen />
      </RequireAuth>
    </Suspense>
  );
}
