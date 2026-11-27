'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { nameSchema, type Profile } from '@workspace/types';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { FieldError } from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';
import { Spinner } from '@workspace/ui/components/spinner';
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs';

import { setLocale } from '@/core/i18n/set-locale';
import { profileApi, queryKeys } from '@/shared/api';
import { LOCALES } from '@/shared/config/i18n/locales';
import { routes } from '@/shared/config/routes';
import { useErrorMessage } from '@/shared/lib/api-error';
import { SettingsCard, SettingsRow } from '@/shared/ui/settings-card';
import { TimeZonePicker } from '@/shared/ui/time-zone-picker';

const LOCALE_NAMES: Record<(typeof LOCALES)[number], string> = { ru: 'Русский', en: 'English' };
const THEMES = ['light', 'dark', 'system'] as const;

const schema = z.object({
  name: nameSchema.or(z.literal('')),
  locale: z.enum(LOCALES),
  timezone: z.string().nullable(),
});
type Values = z.infer<typeof schema>;

/** Personal details (H07): name, language, time zone; theme applies immediately. */
export function ProfileForm({ profile }: { profile: Profile }) {
  const t = useTranslations('profile');
  const tAccount = useTranslations('account');
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const { theme = 'system', setTheme } = useTheme();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      name: profile.displayName ?? '',
      locale: profile.locale,
      timezone: profile.timezone,
    },
  });

  const save = useMutation({
    mutationFn: (values: Values) =>
      profileApi.update({
        displayName: values.name || null,
        locale: values.locale,
        timezone: values.timezone,
      }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(queryKeys.me(), updated);
      toast(t('saved'));
      if (updated.locale !== profile.locale) {
        await setLocale(updated.locale);
        router.refresh();
      }
    },
    onError: (error) => form.setError('root', { message: errorMessage(error) }),
  });

  const { errors, isDirty } = form.formState;

  return (
    <form noValidate onSubmit={form.handleSubmit((values) => save.mutate(values))}>
      <SettingsCard
        title={t('personal')}
        footer={
          <Button type="submit" disabled={!isDirty || save.isPending}>
            {save.isPending ? <Spinner /> : null}
            {t('save')}
          </Button>
        }
      >
        <SettingsRow label={t('name')} htmlFor="profile-name">
          <Input
            id="profile-name"
            autoComplete="name"
            className="sm:w-60"
            aria-invalid={Boolean(errors.name) || undefined}
            {...form.register('name')}
          />
          {errors.name ? <FieldError errors={[errors.name]} /> : null}
        </SettingsRow>
        <SettingsRow
          label={t('email')}
          hint={
            profile.emailVerified ? (
              t('emailHint')
            ) : (
              <span className="flex items-center gap-2">
                <Badge variant="outline">{t('emailUnverified')}</Badge>
                <Link
                  href={routes.verifyEmail(routes.profile())}
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  {t('verify')}
                </Link>
              </span>
            )
          }
          htmlFor="profile-email"
        >
          <Input id="profile-email" value={profile.email} readOnly disabled className="sm:w-60" />
        </SettingsRow>
        <SettingsRow label={t('language')} htmlFor="profile-locale">
          <Controller
            control={form.control}
            name="locale"
            render={({ field }) => (
              <Select value={field.value} onValueChange={(value) => value && field.onChange(value)}>
                <SelectTrigger id="profile-locale" className="w-full sm:w-60">
                  <SelectValue>{(value: Values['locale']) => LOCALE_NAMES[value]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {LOCALES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {LOCALE_NAMES[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </SettingsRow>
        <SettingsRow label={t('timezone')} hint={t('timezoneHint')} htmlFor="profile-timezone">
          <Controller
            control={form.control}
            name="timezone"
            render={({ field }) => (
              <TimeZonePicker
                id="profile-timezone"
                value={field.value}
                onChange={field.onChange}
                nullLabel={t('timezoneProject')}
              />
            )}
          />
        </SettingsRow>
        <SettingsRow label={t('theme')}>
          <Tabs value={theme} onValueChange={(value) => setTheme(String(value))}>
            <TabsList>
              {THEMES.map((value) => (
                <TabsTrigger key={value} value={value}>
                  {tAccount(
                    value === 'light' ? 'themeLight' : value === 'dark' ? 'themeDark' : 'themeSystem',
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </SettingsRow>
        {errors.root ? (
          <div className="px-5 pb-3">
            <FieldError>{errors.root.message}</FieldError>
          </div>
        ) : null}
      </SettingsCard>
    </form>
  );
}
