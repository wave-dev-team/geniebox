import type { ReactNode } from 'react';

import { RequireAuth } from '@/core/auth/auth-gate';

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}
