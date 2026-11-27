'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';

import { Spinner } from '@workspace/ui/components/spinner';

import { useMyProjects } from '@/entities/project';
import { hasRoleAtLeast, preferredProject, useWorkspaces } from '@/entities/workspace';
import { routes } from '@/shared/config/routes';
import { SettingsQueryStatus } from '@/shared/ui/settings-query-status';

export function ProjectEntryGate({ children }: { children: ReactNode }) {
  const directory = useWorkspaces();
  const { select } = directory;
  const projects = useMyProjects();
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const invite = pathname === '/settings' ? params.get('invite') : null;
  const activeId = directory.active?.id;
  const available =
    projects.data?.filter(
      ({ accountBlocked, accountId }) =>
        !accountBlocked && directory.data?.workspaces.some(({ id }) => id === accountId),
    ) ?? [];
  const current =
    preferredProject(
      available.filter(({ accountId }) => accountId === activeId),
      activeId,
    ) ?? (pathname === routes.root() ? available[0] : undefined);
  const selectAccount = current && current.accountId !== activeId ? current.accountId : undefined;

  let destination: string | undefined;
  if (invite) {
    destination = routes.invitation(invite);
  } else if (directory.isSuccess && !activeId) {
    destination = routes.onboarding();
  } else if (directory.isSuccess && projects.isSuccess) {
    if (available.length === 0) destination = routes.onboarding();
    else if (pathname === routes.root() && current?.onboardingStep && hasRoleAtLeast(current.role, 'admin')) {
      destination = routes.onboarding(current.slug);
    }
  }

  useEffect(() => {
    if (selectAccount) select(selectAccount);
    if (destination) router.replace(destination);
  }, [destination, router, select, selectAccount]);

  if (!destination && directory.isError) return <SettingsQueryStatus query={directory} />;
  if (!destination && projects.isError) return <SettingsQueryStatus query={projects} />;
  if (destination || directory.isPending || projects.isPending || selectAccount) {
    return (
      <div className="grid min-h-svh place-items-center">
        <Spinner />
      </div>
    );
  }
  return children;
}
