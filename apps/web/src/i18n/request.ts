import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

import { localeSchema } from '@workspace/types';

import { LOCALE_COOKIE } from '@/shared/config/i18n/locales';

const messages = {
  en: () => import('./en.json'),
  ru: () => import('./ru.json'),
};

export default getRequestConfig(async () => {
  const locale = localeSchema.safeParse((await cookies()).get(LOCALE_COOKIE)?.value).data ?? 'ru';
  return { locale, messages: (await messages[locale]()).default };
});
