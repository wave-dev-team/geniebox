'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Project } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import { Checkbox } from '@workspace/ui/components/checkbox';

import { listOnboardingAgents } from '@/shared/api';
import { SettingsQueryStatus } from '@/shared/ui/settings-query-status';

type Template = Awaited<ReturnType<typeof listOnboardingAgents>>['templates'][number];

export function OnboardingTeam({
  project,
  pending,
  onNext,
}: {
  project: Project;
  pending: boolean;
  onNext: (plannedAgents: string[]) => void;
}) {
  const templates = useQuery({
    queryKey: ['onboarding-agent-catalog', project.accountId],
    queryFn: ({ signal }) => listOnboardingAgents(project.accountId, signal),
  });
  if (templates.isPending || templates.isError) return <SettingsQueryStatus query={templates} />;
  return (
    <ChooseTeam
      project={project}
      pending={pending}
      onNext={onNext}
      templates={templates.data.templates.filter(({ listed, onboarding }) => listed && onboarding.offered)}
    />
  );
}

function ChooseTeam({
  project,
  templates,
  pending,
  onNext,
}: {
  project: Project;
  templates: Template[];
  pending: boolean;
  onNext: (plannedAgents: string[]) => void;
}) {
  const t = useTranslations('onboarding');
  const recommended = (template: Template) =>
    template.onboarding.goals.some((goal) => project.goals.some((active) => active === goal));
  const [selected, setSelected] = useState(() =>
    project.plannedAgents.length || (project.onboardingStep ?? 5) > 3
      ? project.plannedAgents
      : templates
          .filter(recommended)
          .map(({ key }) => key)
          .slice(0, 20),
  );
  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">{t('teamHint')}</p>
      {!templates.length && <p className="text-sm text-muted-foreground">{t('emptyTeam')}</p>}
      <fieldset className="grid gap-2 sm:grid-cols-2" disabled={pending} aria-label={t('steps.team')}>
        {templates.map((template) => (
          <label className="flex items-start gap-3 rounded-lg border p-3" key={template.key}>
            <Checkbox
              checked={selected.includes(template.key)}
              disabled={pending || (selected.length >= 20 && !selected.includes(template.key))}
              onCheckedChange={(checked) =>
                setSelected((items) =>
                  checked ? [...items, template.key] : items.filter((key) => key !== template.key),
                )
              }
            />
            <span className="grid gap-1 text-sm">
              <strong>{template.name}</strong>
              <span className="text-muted-foreground">{template.short || template.role}</span>
              {recommended(template) && <span className="text-xs font-medium">{t('recommended')}</span>}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex justify-end">
        <Button disabled={pending} onClick={() => onNext(selected)}>
          {t('continue')}
        </Button>
      </div>
    </div>
  );
}
