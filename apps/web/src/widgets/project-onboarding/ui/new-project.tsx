'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useRef } from 'react';

import type { Workspace } from '@workspace/types';

import { OnboardingFrame } from './onboarding-frame';
import { type AboutValues, ProjectAboutForm } from './project-about-form';

import { useMyProjects, useRefreshProjects } from '@/entities/project';
import { hasRoleAtLeast, useWorkspaces } from '@/entities/workspace';
import { accountsApi, projectsApi } from '@/shared/api';
import { routes } from '@/shared/config/routes';
import { useErrorMessage } from '@/shared/lib/api-error';
import { SettingsQueryStatus } from '@/shared/ui/settings-query-status';

export function NewProject() {
  const t = useTranslations('onboarding');
  const router = useRouter();
  const locale = useLocale() === 'en' ? 'en' : 'ru';
  const directory = useWorkspaces();
  const projects = useMyProjects();
  const errorMessage = useErrorMessage();
  const refresh = useRefreshProjects();
  const createdAccount = useRef<Workspace>(null);
  const create = useMutation({
    mutationFn: async (values: AboutValues) => {
      const allowed = directory.data?.workspaces.filter(({ role }) => hasRoleAtLeast(role, 'admin')) ?? [];
      let account =
        createdAccount.current ?? allowed.find(({ id }) => id === directory.active?.id) ?? allowed[0];
      if (!account) {
        account = await accountsApi.create(values.name, locale);
        createdAccount.current = account;
        directory.activate(account);
      }
      const project = await accountsApi.createProject(account.id, values);
      // If advancing fails, step 1 can be resumed on the saved project without creating another.
      const advanced = await projectsApi
        .update(account.id, project.id, { onboardingStep: 2 })
        .catch(() => project);
      return { account, project: advanced };
    },
    onSuccess: async ({ account, project }) => {
      sessionStorage.setItem(`geniebox:project:${account.id}`, project.id);
      directory.select(account.id);
      await refresh(project);
      router.replace(routes.onboarding(project.slug));
    },
  });

  return (
    <OnboardingFrame
      step={1}
      title={t('createTitle')}
      laterHref={projects.data?.some(({ accountBlocked }) => !accountBlocked) ? routes.root() : undefined}
    >
      {directory.isPending || directory.isError ? (
        <SettingsQueryStatus query={directory} />
      ) : (
        <ProjectAboutForm
          onSubmit={(values) => create.mutate(values)}
          pending={create.isPending}
          error={create.error ? errorMessage(create.error) : undefined}
        />
      )}
      <Link
        href={routes.invitation()}
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        {t('haveInvite')}
      </Link>
    </OnboardingFrame>
  );
}
