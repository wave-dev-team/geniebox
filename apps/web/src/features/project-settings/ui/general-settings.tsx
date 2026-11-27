'use client';

import { useTranslations } from 'next-intl';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@workspace/ui/components/button';
import { Input } from '@workspace/ui/components/input';
import { Spinner } from '@workspace/ui/components/spinner';
import { Textarea } from '@workspace/ui/components/textarea';

import {
  CLIENT_ADDRESSES,
  CLIENT_LANGUAGES,
  CLIENT_TONES,
  CURRENCIES,
  DATE_FORMAT_EXAMPLE,
  DATE_FORMATS,
  MAIN_METRICS,
  NUMBER_FORMAT_EXAMPLE,
  NUMBER_FORMATS,
  type Project,
  SPHERES,
  useUpdateProject,
  WEEK_STARTS,
} from '@/entities/project';
import { useErrorMessage } from '@/shared/lib/api-error';
import { OptionSelect } from '@/shared/ui/option-select';
import { SettingsCard, SettingsRow } from '@/shared/ui/settings-card';
import { TimeZonePicker } from '@/shared/ui/time-zone-picker';

type Values = Pick<
  Project,
  | 'name'
  | 'sphere'
  | 'mainMetric'
  | 'currency'
  | 'timezone'
  | 'numberFormat'
  | 'dateFormat'
  | 'weekStart'
  | 'clientLanguage'
  | 'clientTone'
  | 'clientAddress'
> & { monthGoal: string; customMetric: string; clientSignature: string };

const toValues = (project: Project): Values => ({
  name: project.name,
  sphere: project.sphere,
  monthGoal: project.monthGoal ?? '',
  mainMetric: project.mainMetric,
  customMetric: project.customMetric ?? '',
  currency: project.currency,
  timezone: project.timezone,
  numberFormat: project.numberFormat,
  dateFormat: project.dateFormat,
  weekStart: project.weekStart,
  clientLanguage: project.clientLanguage,
  clientTone: project.clientTone,
  clientAddress: project.clientAddress,
  clientSignature: project.clientSignature ?? '',
});

/** General settings: project, metrics and units, talking to customers. */
export function GeneralSettings({ project, editable }: { project: Project; editable: boolean }) {
  const t = useTranslations('projectSettings');
  const o = useTranslations('projectOptions');
  const errorMessage = useErrorMessage();
  const update = useUpdateProject(project.accountId, project.id);
  const form = useForm<Values>({ values: toValues(project) });
  const mainMetric = form.watch('mainMetric');

  const submit = form.handleSubmit((values) =>
    update.mutate(
      {
        ...values,
        name: values.name.trim() || project.name,
        monthGoal: values.monthGoal.trim() || null,
        customMetric: values.mainMetric === 'custom' ? values.customMetric.trim() || null : null,
        clientSignature: values.clientSignature.trim() || null,
      },
      {
        onSuccess: () => toast(t('saved')),
        onError: (error) => form.setError('root', { message: errorMessage(error) }),
      },
    ),
  );

  return (
    <form noValidate onSubmit={submit}>
      <fieldset disabled={!editable} className="flex flex-col gap-4">
        {!editable ? <p className="text-sm text-muted-foreground">{t('readOnly')}</p> : null}
        <SettingsCard title={t('project')} description={t('projectHint')}>
          <SettingsRow label={t('name')} htmlFor="project-name">
            <Input id="project-name" className="sm:w-60" maxLength={120} {...form.register('name')} />
          </SettingsRow>
          <SettingsRow label={t('sphere')} hint={t('sphereHint')} htmlFor="project-sphere">
            <Controller
              control={form.control}
              name="sphere"
              render={({ field }) => (
                <OptionSelect
                  id="project-sphere"
                  value={field.value}
                  options={SPHERES}
                  label={(value) => o(`sphere.${value}`)}
                  onChange={field.onChange}
                  disabled={!editable}
                  placeholder={t('spherePlaceholder')}
                />
              )}
            />
          </SettingsRow>
          <div className="flex flex-col gap-2 px-5 py-3.5">
            <label htmlFor="project-goal" className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{t('monthGoal')}</span>
              <span className="text-sm text-muted-foreground">{t('monthGoalHint')}</span>
            </label>
            <Textarea
              id="project-goal"
              rows={2}
              maxLength={300}
              placeholder={t('monthGoalPlaceholder')}
              {...form.register('monthGoal')}
            />
          </div>
        </SettingsCard>

        <SettingsCard title={t('metrics')} description={t('metricsHint')}>
          <SettingsRow label={t('mainMetric')} hint={t('mainMetricHint')} htmlFor="project-metric">
            <Controller
              control={form.control}
              name="mainMetric"
              render={({ field }) => (
                <OptionSelect
                  id="project-metric"
                  value={field.value}
                  options={MAIN_METRICS}
                  label={(value) => o(`metric.${value}`)}
                  onChange={field.onChange}
                  disabled={!editable}
                />
              )}
            />
          </SettingsRow>
          {mainMetric === 'custom' ? (
            <SettingsRow label={t('customMetric')} htmlFor="project-custom-metric">
              <Input
                id="project-custom-metric"
                className="sm:w-60"
                maxLength={100}
                {...form.register('customMetric')}
              />
            </SettingsRow>
          ) : null}
          <SettingsRow label={t('currency')} htmlFor="project-currency">
            <Controller
              control={form.control}
              name="currency"
              render={({ field }) => (
                <OptionSelect
                  id="project-currency"
                  value={field.value}
                  options={CURRENCIES}
                  label={(value) => o(`currency.${value}`)}
                  onChange={field.onChange}
                  disabled={!editable}
                />
              )}
            />
          </SettingsRow>
          <SettingsRow label={t('timezone')} hint={t('timezoneHint')} htmlFor="project-timezone">
            <Controller
              control={form.control}
              name="timezone"
              render={({ field }) => (
                <TimeZonePicker
                  id="project-timezone"
                  value={field.value}
                  onChange={(value) => value && field.onChange(value)}
                />
              )}
            />
          </SettingsRow>
          <SettingsRow label={t('numberFormat')} htmlFor="project-number-format">
            <Controller
              control={form.control}
              name="numberFormat"
              render={({ field }) => (
                <OptionSelect
                  id="project-number-format"
                  value={field.value}
                  options={NUMBER_FORMATS}
                  label={(value) => NUMBER_FORMAT_EXAMPLE[value]}
                  onChange={field.onChange}
                  disabled={!editable}
                />
              )}
            />
          </SettingsRow>
          <SettingsRow label={t('dateFormat')} htmlFor="project-date-format">
            <Controller
              control={form.control}
              name="dateFormat"
              render={({ field }) => (
                <OptionSelect
                  id="project-date-format"
                  value={field.value}
                  options={DATE_FORMATS}
                  label={(value) => DATE_FORMAT_EXAMPLE[value]}
                  onChange={field.onChange}
                  disabled={!editable}
                />
              )}
            />
          </SettingsRow>
          <SettingsRow label={t('weekStart')} htmlFor="project-week-start">
            <Controller
              control={form.control}
              name="weekStart"
              render={({ field }) => (
                <OptionSelect
                  id="project-week-start"
                  value={field.value}
                  options={WEEK_STARTS}
                  label={(value) => o(`weekStart.${value}`)}
                  onChange={field.onChange}
                  disabled={!editable}
                />
              )}
            />
          </SettingsRow>
        </SettingsCard>

        <SettingsCard title={t('clients')} description={t('clientsHint')}>
          <SettingsRow label={t('clientLanguage')} htmlFor="project-client-language">
            <Controller
              control={form.control}
              name="clientLanguage"
              render={({ field }) => (
                <OptionSelect
                  id="project-client-language"
                  value={field.value}
                  options={CLIENT_LANGUAGES}
                  label={(value) => o(`clientLanguage.${value}`)}
                  onChange={field.onChange}
                  disabled={!editable}
                />
              )}
            />
          </SettingsRow>
          <SettingsRow label={t('clientTone')} htmlFor="project-client-tone">
            <Controller
              control={form.control}
              name="clientTone"
              render={({ field }) => (
                <OptionSelect
                  id="project-client-tone"
                  value={field.value}
                  options={CLIENT_TONES}
                  label={(value) => o(`clientTone.${value}`)}
                  onChange={field.onChange}
                  disabled={!editable}
                />
              )}
            />
          </SettingsRow>
          <SettingsRow label={t('clientAddress')} htmlFor="project-client-address">
            <Controller
              control={form.control}
              name="clientAddress"
              render={({ field }) => (
                <OptionSelect
                  id="project-client-address"
                  value={field.value}
                  options={CLIENT_ADDRESSES}
                  label={(value) => o(`clientAddress.${value}`)}
                  onChange={field.onChange}
                  disabled={!editable}
                />
              )}
            />
          </SettingsRow>
          <SettingsRow
            label={t('clientSignature')}
            hint={t('clientSignatureHint')}
            htmlFor="project-client-signature"
          >
            <Input
              id="project-client-signature"
              className="sm:w-60"
              maxLength={200}
              placeholder={t('clientSignaturePlaceholder')}
              {...form.register('clientSignature')}
            />
          </SettingsRow>
        </SettingsCard>
        {editable ? (
          <SaveBar
            dirty={form.formState.isDirty}
            pending={update.isPending}
            error={form.formState.errors.root?.message}
            label={t('save')}
          />
        ) : null}
      </fieldset>
    </form>
  );
}
