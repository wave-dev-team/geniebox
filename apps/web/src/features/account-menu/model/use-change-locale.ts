'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { toast } from 'sonner';

import { setLocale } from '@/core/i18n/set-locale';
import { profileApi, queryKeys } from '@/shared/api';
import { isLocale, type Locale } from '@/shared/config/i18n/locales';
import { useErrorMessage } from '@/shared/lib/api-error';

export function useChangeLocale() {
  const activeLocale = useLocale();
  const locale = isLocale(activeLocale) ? activeLocale : 'ru';
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const { mutate } = useMutation({
    mutationFn: (next: Locale) => profileApi.update({ locale: next }),
    onSuccess: async (profile) => {
      queryClient.setQueryData(queryKeys.me(), profile);
      await setLocale(profile.locale);
      router.refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    locale,
    change: (next: Locale) => {
      if (next !== locale) mutate(next);
    },
  };
}
