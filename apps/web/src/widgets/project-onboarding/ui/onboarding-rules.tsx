'use client';

import { useTranslations } from 'next-intl';
import { Controller, useForm } from 'react-hook-form';

import { ALWAYS_ASK, type Project, TRUST_LEVELS } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import { Checkbox } from '@workspace/ui/components/checkbox';
import { Input } from '@workspace/ui/components/input';

import { OptionSelect } from '@/shared/ui/option-select';

export type Rules = Pick<Project, 'defaultTrustLevel' | 'alwaysAsk' | 'aiBudgetMonthly'>;

export function OnboardingRules({
  project,
  pending,
  onNext,
}: {
  project: Project;
  pending: boolean;
  onNext: (rules: Rules) => void;
}) {
  const t = useTranslations('onboarding');
  const general = useTranslations('projectSettings');
  const options = useTranslations('projectOptions');
  const form = useForm<Rules>({
    defaultValues: {
      defaultTrustLevel: project.defaultTrustLevel,
      alwaysAsk: project.alwaysAsk,
      aiBudgetMonthly: project.aiBudgetMonthly,
    },
  });
  return (
    <form
      className="grid gap-5"
      onSubmit={form.handleSubmit((values) => {
        if (!pending) onNext(values);
      })}
    >
      <p className="text-sm text-muted-foreground">{t('rulesHint')}</p>
      <fieldset disabled={pending} className="grid gap-5">
        <div className="grid gap-2">
          <label htmlFor="onboarding-trust" className="text-sm font-medium">
            {general('trust')}
          </label>
          <Controller
            name="defaultTrustLevel"
            control={form.control}
            render={({ field }) => (
              <OptionSelect
                id="onboarding-trust"
                value={field.value}
                onChange={field.onChange}
                options={TRUST_LEVELS}
                label={(level) => options(`trust.${level}`)}
                disabled={pending}
              />
            )}
          />
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">{general('asks')}</legend>
          <Controller
            name="alwaysAsk"
            control={form.control}
            render={({ field }) => (
              <div className="grid gap-2">
                {ALWAYS_ASK.map((ask) => (
                  <label key={ask} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={field.value.includes(ask)}
                      disabled={pending}
                      onCheckedChange={(checked) =>
                        field.onChange(
                          checked ? [...field.value, ask] : field.value.filter((item) => item !== ask),
                        )
                      }
                    />
                    {options(`ask.${ask}`)}
                  </label>
                ))}
              </div>
            )}
          />
        </fieldset>
        <label className="grid gap-2 text-sm font-medium">
          {general('budget')}
          <Input
            className="sm:w-60"
            type="number"
            min={0}
            max={100000000}
            step={1}
            required
            {...form.register('aiBudgetMonthly', { valueAsNumber: true })}
          />
        </label>
      </fieldset>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {t('continue')}
        </Button>
      </div>
    </form>
  );
}
