'use client';

import { useTranslations } from 'next-intl';
import { Controller, useForm } from 'react-hook-form';

import { type Project, PROJECT_GOALS, PROJECT_SPHERES } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import { Checkbox } from '@workspace/ui/components/checkbox';
import { Input } from '@workspace/ui/components/input';
import { Textarea } from '@workspace/ui/components/textarea';

import { OptionSelect } from '@/shared/ui/option-select';

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
  const o = useTranslations('projectOptions');
  const general = useTranslations('projectSettings');
  const form = useForm<AboutValues>({
    defaultValues: {
      name: project?.name ?? '',
      sphere: project?.sphere ?? null,
      about: project?.about ?? '',
      goals: project?.goals ?? [],
    },
  });
  return (
    <form
      className="grid gap-5"
      onSubmit={form.handleSubmit((values) => {
        const name = values.name.trim();
        if (name && !pending) onSubmit({ ...values, name, about: values.about?.trim() || null });
        else if (!name) form.setError('name', { message: t('nameRequired') });
      })}
    >
      <fieldset disabled={pending} className="grid gap-5">
        <label className="grid gap-2 text-sm font-medium">
          {general('name')}
          <Input
            {...form.register('name')}
            autoComplete="organization"
            required
            maxLength={120}
            placeholder={t('projectName')}
          />
          {form.formState.errors.name && (
            <span role="alert" className="text-destructive">
              {form.formState.errors.name.message}
            </span>
          )}
        </label>
        <div className="grid gap-2">
          <label htmlFor="onboarding-sphere" className="text-sm font-medium">
            {general('sphere')}
          </label>
          <Controller
            control={form.control}
            name="sphere"
            render={({ field }) => (
              <OptionSelect
                id="onboarding-sphere"
                value={field.value}
                onChange={field.onChange}
                options={PROJECT_SPHERES}
                className="w-full"
                disabled={pending}
                label={(value) => o(`sphere.${value}`)}
                placeholder={general('spherePlaceholder')}
              />
            )}
          />
        </div>
        <label className="grid gap-2 text-sm font-medium">
          {general('about')}
          <Textarea {...form.register('about')} rows={3} maxLength={2000} />
        </label>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">{general('goals')}</legend>
          <Controller
            control={form.control}
            name="goals"
            render={({ field }) => (
              <div className="grid gap-2 sm:grid-cols-2">
                {PROJECT_GOALS.map((goal) => (
                  <label key={goal} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={field.value.includes(goal)}
                      disabled={pending}
                      onCheckedChange={(checked) =>
                        field.onChange(
                          checked ? [...field.value, goal] : field.value.filter((item) => item !== goal),
                        )
                      }
                    />
                    {o(`goal.${goal}`)}
                  </label>
                ))}
              </div>
            )}
          />
        </fieldset>
      </fieldset>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {t('continue')}
        </Button>
      </div>
    </form>
  );
}
