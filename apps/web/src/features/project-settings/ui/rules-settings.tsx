'use client';

import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import type { Project } from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import { Checkbox } from '@workspace/ui/components/checkbox';
import { Input } from '@workspace/ui/components/input';
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs';

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
      <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-4">
        {!editable && <p className="text-sm text-muted-foreground">{t('readOnly')}</p>}
        <SettingsCard title={t('newAgents')}>
          <SettingsRow label={t('trust')} hint={t('trustHint')}>
            <Controller
              control={form.control}
              name="defaultTrustLevel"
              render={({ field }) => (
                <Tabs value={field.value} onValueChange={field.onChange}>
                  <TabsList
                    aria-label={t('trust')}
                    className="h-auto max-w-full flex-wrap group-data-horizontal/tabs:h-auto"
                  >
                    {TRUST_LEVELS.map((level) => (
                      <TabsTrigger key={level} value={level} disabled={disabled}>
                        {o(`trust.${level}`)}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              )}
            />
          </SettingsRow>
          <SettingsRow label={t('probation')} hint={t('probationHint')} htmlFor="rules-probation">
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
          <SettingsRow label={t('streak')} hint={t('streakHint')} htmlFor="rules-streak">
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
        <SettingsCard title={t('asks')} description={t('asksHint')}>
          <Controller
            control={form.control}
            name="alwaysAsk"
            render={({ field }) => (
              <ul>
                {ALWAYS_ASK.map((ask) => (
                  <li key={ask} className="border-b last:border-b-0">
                    <label
                      htmlFor={`ask-${ask}`}
                      className="flex cursor-pointer items-center gap-3 px-5 py-3 text-sm"
                    >
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
                      {o(`ask.${ask}`)}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          />
        </SettingsCard>
        <SettingsCard title={t('limits')} description={t('limitsHint')}>
          <SettingsRow label={t('budget')} hint={t('budgetHint')} htmlFor="rules-budget">
            <Input
              id="rules-budget"
              className="sm:w-36"
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
          description={t('agentRulesHint')}
          action={
            editable && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={instructions.fields.length >= 50}
                onClick={() => instructions.append({ text: '' })}
              >
                <Plus />
                {t('addRule')}
              </Button>
            )
          }
        >
          {instructions.fields.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">{t('noRules')}</p>
          ) : (
            <ul>
              {instructions.fields.map((instruction, index) => (
                <li
                  key={instruction.id}
                  className="flex items-center gap-2 border-b px-5 py-2.5 last:border-b-0"
                >
                  <Input
                    aria-label={t('ruleNumber', { number: index + 1 })}
                    maxLength={300}
                    placeholder={t('agentRulePlaceholder')}
                    {...form.register(`instructions.${index}.text`)}
                  />
                  {editable && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('removeRule')}
                      onClick={() => instructions.remove(index)}
                    >
                      <X />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
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
