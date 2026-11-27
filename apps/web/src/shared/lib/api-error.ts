'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { ApiError } from '@/shared/api';

export function useErrorMessage() {
  const t = useTranslations('errors');

  return useCallback(
    (error: unknown) => {
      const code = error instanceof ApiError ? error.code : undefined;
      return code && t.has(code) ? t(code) : (error instanceof ApiError && error.detail) || t('generic');
    },
    [t],
  );
}
