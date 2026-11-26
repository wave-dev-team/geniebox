import type { ReactNode } from 'react';

import { RequireAuth } from '@/core/auth/auth-gate';
import { AppShell } from '@/widgets/app-shell/ui/app-shell';

export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
