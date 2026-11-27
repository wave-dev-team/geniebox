import type { ReactNode } from 'react';

import { RequireAuth } from '@/core/auth/auth-gate';
import { ProjectEntryGate } from '@/core/auth/project-entry-gate';
import { AppShell } from '@/widgets/app-shell/ui/app-shell';

export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <ProjectEntryGate>
        <AppShell>{children}</AppShell>
      </ProjectEntryGate>
    </RequireAuth>
  );
}
