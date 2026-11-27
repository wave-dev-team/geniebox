import type { ReactNode } from 'react';

import { RequireAuth } from '@/core/auth/auth-gate';
import { FirstAccountDialog } from '@/features/create-account/ui/create-account-dialog';
import { AppShell } from '@/widgets/app-shell/ui/app-shell';

export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>
        {children}
        <FirstAccountDialog />
      </AppShell>
    </RequireAuth>
  );
}
