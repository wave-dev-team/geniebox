import { useTranslations } from 'next-intl';
import * as React from 'react';
import { z } from 'zod';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@workspace/types';

/** Zod schemas for auth forms with localized messages; rules mirror the backend DTOs. */
export function useAuthSchemas() {
  const t = useTranslations('auth.validation');
  return React.useMemo(() => {
    const email = z.string().trim().email(t('email')).max(254, t('email'));
    const newPassword = z
      .string()
      .min(PASSWORD_MIN_LENGTH, t('passwordMin', { min: PASSWORD_MIN_LENGTH }))
      .max(PASSWORD_MAX_LENGTH);
    const password = z.string().min(1, t('required')).max(PASSWORD_MAX_LENGTH);
    const code = z.string().regex(/^\d{6}$/, t('code'));
    return { email, password, newPassword, code };
  }, [t]);
}
