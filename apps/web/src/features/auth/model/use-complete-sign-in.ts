'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';

import type { AuthResult } from '@workspace/types';

import { setLocale } from '@/core/i18n/set-locale';
import { profileApi, queryKeys } from '@/shared/api';
import { routes, safeNextPath } from '@/shared/config/routes';

export function useNextPath() {
  return safeNextPath(useSearchParams().get('next'));
}

export function useCompleteSignIn() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const next = useNextPath();
  const locale = useLocale();

  return async (result: AuthResult, target?: string) => {
    const destination = next ?? routes.root();
    await queryClient.cancelQueries({ queryKey: queryKeys.me() });
    queryClient.removeQueries({ queryKey: queryKeys.sessions() });
    const profile = await profileApi.me();
    queryClient.setQueryData(queryKeys.me(), profile);
    if (profile.locale !== locale) await setLocale(profile.locale);
    router.replace(target ?? (result.emailVerified ? destination : routes.verifyEmail(destination)));
  };
}
