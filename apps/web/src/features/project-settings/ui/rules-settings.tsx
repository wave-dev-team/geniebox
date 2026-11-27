'use client';

import { useTranslations } from 'next-intl';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import type { Project } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import { Checkbox } from '@workspace/ui/components/checkbox';
import { Input } from '@workspace/ui/components/input';

import { SaveBar } from './save-bar';

import {
  ALWAYS_ASK,
  PROBATION_DAYS,
  TRUST_LEVELS,
  TRUST_STREAKS,
  useUpdateProjectRules,
} from '@/entities/project';
import { useErrorMessage } from '@/shared/lib/api-error';
import { OptionSelect } from '@/shared/ui/option-select';
import { SettingsCard, SettingsRow } from '@/shared/ui/settings-card';

type Values = Pick<
  Project,
  'defaultTrustLevel' | 'probationDays' | 'trustStreak' | 'alwaysAsk' | 'aiBudgetMonthly'
> & {
  instructions: { text: string }[];
};

export function RulesSettings({ project, editable }: { project: Project; editable: boolean }) {
  const t = useTranslations('projectSettings');
  const o = useTranslations('projectOptions');
  const errorMessage = useErrorMessage();
  const update = useUpdateProjectRules(project.accountId, project.id);
  const form = useForm<Values>({
    values: {
      defaultTrustLevel: project.defaultTrustLevel,
      probationDays: project.probationDays,
      trustStreak: project.trustStreak,
      alwaysAsk: project.alwaysAsk,
      aiBudgetMonthly: project.aiBudgetMonthly,
      instructions: project.agentRules.map((text) => ({ text })),
    },
  });
  const instructions = useFieldArray({ control: form.control, name: 'instructions' });
  const disabled = !editable || update.isPending;
  const submit = form.handleSubmit(({ instructions, ...values }) => {
    update.mutate(
      { ...values, agentRules: instructions.map(({ text }) => text.trim()).filter(Boolean) },
      {
        onSuccess: () => toast.success(t('saved')),
        onError: (error) => form.setError('root', { message: errorMessage(error) }),
      },
    );
  });

  return (
    <form onSubmit={submit}>
      <fieldset disabled={disabled} className="grid gap-4">
        {!editable && <p className="text-sm text-muted-foreground">{t('readOnly')}</p>}
        <SettingsCard title={t('newAgents')}>
          <SettingsRow label={t('trust')} htmlFor="rules-trust">
            <Controller
              control={form.control}
              name="defaultTrustLevel"
              render={({ field }) => (
                <OptionSelect
                  id="rules-trust"
                  value={field.value}
                  options={TRUST_LEVELS}
                  label={(value) => o(`trust.${value}`)}
                  onChange={field.onChange}
                  disabled={disabled}
                />
              )}
            />
          </SettingsRow>
          <SettingsRow label={t('probation')} htmlFor="rules-probation">
            <Controller
              control={form.control}
              name="probationDays"
              render={({ field }) => (
                <OptionSelect
                  id="rules-probation"
                  value={field.value}
                  options={PROBATION_DAYS}
                  label={(count) => o('days', { count })}
                  onChange={field.onChange}
                  disabled={disabled}
                />
              )}
            />
          </SettingsRow>
          <SettingsRow label={t('streak')} htmlFor="rules-streak">
            <Controller
              control={form.control}
              name="trustStreak"
              render={({ field }) => (
                <OptionSelect
                  id="rules-streak"
                  value={field.value}
                  options={TRUST_STREAKS}
                  label={String}
                  onChange={field.onChange}
                  disabled={disabled}
                />
              )}
            />
          </SettingsRow>
        </SettingsCard>
        <SettingsCard title={t('asks')}>
          <Controller
            control={form.control}
            name="alwaysAsk"
            render={({ field }) => (
              <>
                {ALWAYS_ASK.map((ask) => (
                  <SettingsRow key={ask} label={o(`ask.${ask}`)} htmlFor={`ask-${ask}`}>
                    <Checkbox
                      id={`ask-${ask}`}
                      checked={field.value.includes(ask)}
                      disabled={disabled}
                      onCheckedChange={(checked) =>
                        field.onChange(
                          checked ? [...field.value, ask] : field.value.filter((item) => item !== ask),
                        )
                      }
                    />
                  </SettingsRow>
                ))}
              </>
            )}
          />
        </SettingsCard>
        <SettingsCard title={t('limits')}>
          <SettingsRow label={t('budget')} htmlFor="rules-budget">
            <Input
              id="rules-budget"
              type="number"
              min={0}
              max={100000000}
              step={1}
              required
              {...form.register('aiBudgetMonthly', { valueAsNumber: true })}
            />
          </SettingsRow>
        </SettingsCard>
        <SettingsCard
          title={t('agentRules')}
          action={
            editable && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={instructions.fields.length >= 50}
                onClick={() => instructions.append({ text: '' })}
              >
                {t('addRule')}
              </Button>
            )
          }
        >
          {instructions.fields.length === 0 && (
            <p className="p-5 text-sm text-muted-foreground">{t('noRules')}</p>
          )}
          {instructions.fields.map((instruction, index) => (
            <SettingsRow
              key={instruction.id}
              label={t('ruleNumber', { number: index + 1 })}
              htmlFor={instruction.id}
            >
              <Input id={instruction.id} maxLength={300} {...form.register(`instructions.${index}.text`)} />
              {editable && (
                <Button type="button" variant="ghost" onClick={() => instructions.remove(index)}>
                  {t('removeRule')}
                </Button>
              )}
            </SettingsRow>
          ))}
        </SettingsCard>
        {editable && (
          <SaveBar
            dirty={form.formState.isDirty}
            pending={update.isPending}
            error={form.formState.errors.root?.message}
            label={t('save')}
          />
        )}
      </fieldset>
    </form>
  );
}
