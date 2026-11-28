'use client';

import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';

import type { Project } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { Spinner } from '@workspace/ui/components/spinner';
import { Textarea } from '@workspace/ui/components/textarea';

export type AboutValues = Pick<Project, 'name' | 'sphere' | 'goals'> & { about: string | null };

export function ProjectAboutForm({
  project,
  pending,
  error,
  onSubmit,
}: {
  project?: AboutValues;
  pending: boolean;
  error?: string;
  onSubmit: (values: AboutValues) => void;
}) {
  const t = useTranslations('onboarding');
  const general = useTranslations('projectSettings');
  const form = useForm<AboutValues>({
    defaultValues: {
      name: project?.name ?? '',
      sphere: project?.sphere ?? null,
      about: project?.about ?? '',
      goals: project?.goals ?? [],
    },
  });
  const { errors } = form.formState;

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => {
        const name = values.name.trim();
        if (name && !pending) onSubmit({ ...values, name, about: values.about?.trim() || null });
        else if (!name) form.setError('name', { message: t('nameRequired') });
      })}
    >
      <FieldGroup>
        <Field data-invalid={Boolean(errors.name) || undefined}>
          <FieldLabel htmlFor="project-name">{general('name')}</FieldLabel>
          <Input
            id="project-name"
            {...form.register('name')}
            autoComplete="organization"
            required
            maxLength={120}
            disabled={pending}
            placeholder={t('projectName')}
            aria-invalid={Boolean(errors.name) || undefined}
          />
          <FieldError errors={[errors.name]} />
        </Field>
        <Field>
          <FieldLabel htmlFor="project-about">{general('about')}</FieldLabel>
          <Textarea
            id="project-about"
            {...form.register('about')}
            rows={3}
            maxLength={2000}
            disabled={pending}
            placeholder={t('projectAboutPlaceholder')}
          />
        </Field>
        {error ? <FieldError>{error}</FieldError> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            {t('continue')}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
