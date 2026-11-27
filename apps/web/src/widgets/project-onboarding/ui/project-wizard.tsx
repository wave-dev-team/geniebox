'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { MyProject, Project, ProjectUpdate } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';

import { OnboardingConnections } from './onboarding-connections';
import { OnboardingFrame } from './onboarding-frame';
import { OnboardingRules, type Rules } from './onboarding-rules';
import { OnboardingTeam } from './onboarding-team';
import { ProjectAboutForm } from './project-about-form';

import { useMyProjects, useProject, useRefreshProjects } from '@/entities/project';
import { hasRoleAtLeast, useWorkspaces } from '@/entities/workspace';
import { projectsApi } from '@/shared/api';
import { routes } from '@/shared/config/routes';
import { useErrorMessage } from '@/shared/lib/api-error';
import { SettingsQueryStatus } from '@/shared/ui/settings-query-status';

export function ProjectWizard({ slug }: { slug: string }) {
  const t = useTranslations('onboarding');
  const projects = useMyProjects();
  const project = projects.data?.find((item) => item.slug === slug && !item.accountBlocked);
  if (projects.isPending || projects.isError) {
    return (
      <OnboardingFrame step={1} title={t('setupTitle')}>
        <SettingsQueryStatus query={projects} />
      </OnboardingFrame>
    );
  }
  if (!project || !hasRoleAtLeast(project.role, 'admin')) {
    return (
      <OnboardingFrame step={1} title={t('unavailable')}>
        <Button render={<Link href={routes.root()} />} nativeButton={false}>
          {t('backHome')}
        </Button>
      </OnboardingFrame>
    );
  }
  return <WizardProject key={project.id} summary={project} />;
}

function WizardProject({ summary }: { summary: MyProject }) {
  const t = useTranslations('onboarding');
  const project = useProject(summary.accountId, summary.id);
  if (project.isPending || project.isError) {
    return (
      <OnboardingFrame step={summary.onboardingStep ?? 5} title={t('setupTitle')} project={summary.name}>
        <SettingsQueryStatus query={project} />
      </OnboardingFrame>
    );
  }
  return <WizardForm project={project.data} />;
}

function WizardForm({ project }: { project: Project }) {
  const t = useTranslations('onboarding');
  const router = useRouter();
  const directory = useWorkspaces();
  const refresh = useRefreshProjects();
  const errorMessage = useErrorMessage();
  const { accountId, id } = project;
  const [viewStep, setViewStep] = useState<number>();
  const reached = project.onboardingStep ?? 5;
  const step = viewStep ?? reached;

  const advance = useMutation({
    mutationFn: async ({ next, patch, rules }: { next: number; patch?: ProjectUpdate; rules?: Rules }) => {
      if (rules) await projectsApi.updateRules(accountId, id, rules);
      return projectsApi.update(accountId, id, { ...patch, onboardingStep: Math.max(next, reached) });
    },
    onSuccess: async (saved, { next }) => {
      await refresh(saved);
      setViewStep(next);
    },
  });

  function openProject(href: string) {
    directory.select(accountId);
    sessionStorage.setItem(`geniebox:project:${accountId}`, id);
    router.replace(href);
  }

  const finish = useMutation({
    mutationFn: () => projectsApi.completeOnboarding(accountId, id),
    onSuccess: async (saved) => {
      await refresh(saved);
      openProject(routes.root());
    },
  });

  if (project.onboardingStep === null) {
    return (
      <OnboardingFrame step={5} project={project.name} title={t('readyTitle')}>
        <Button disabled={!directory.isSuccess} onClick={() => openProject(routes.root())}>
          {t('openProject')}
        </Button>
      </OnboardingFrame>
    );
  }

  const pending = advance.isPending || finish.isPending;
  const error = advance.error ?? finish.error;
  const titles = [t('setupTitle'), t('connectionsTitle'), t('teamTitle'), t('rulesTitle'), t('readyTitle')];
  return (
    <OnboardingFrame step={step} project={project.name} title={titles[step - 1] ?? t('setupTitle')}>
      {step === 1 && (
        <ProjectAboutForm
          project={project}
          pending={pending}
          onSubmit={(values) => advance.mutate({ next: 2, patch: values })}
        />
      )}
      {step === 2 && (
        <OnboardingConnections
          project={project}
          pending={pending}
          onNext={() => advance.mutate({ next: 3 })}
        />
      )}
      {step === 3 && (
        <OnboardingTeam
          project={project}
          pending={pending}
          onNext={(plannedAgents) => advance.mutate({ next: 4, patch: { plannedAgents } })}
        />
      )}
      {step === 4 && (
        <OnboardingRules
          project={project}
          pending={pending}
          onNext={(rules) => advance.mutate({ next: 5, rules })}
        />
      )}
      {step === 5 && (
        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            {t('readyHint', { count: project.plannedAgents.length })}
          </p>
          <div className="flex justify-end">
            <Button disabled={pending || !directory.isSuccess} onClick={() => finish.mutate()}>
              {t('openProject')}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage(error)}
        </p>
      )}
      {
        <footer className="flex items-center justify-between gap-3 border-t pt-4">
          {step > 1 ? (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                advance.reset();
                setViewStep(step - 1);
              }}
            >
              {t('back')}
            </Button>
          ) : (
            <span />
          )}
          {step < 5 && (
            <Button
              variant="link"
              disabled={pending || !directory.isSuccess}
              onClick={() => openProject(routes.chat())}
            >
              {t('later')}
            </Button>
          )}
        </footer>
      }
    </OnboardingFrame>
  );
}
