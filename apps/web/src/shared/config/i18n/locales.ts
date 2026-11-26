import { locales, localeSchema } from '@workspace/types';

export const LOCALES = locales;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = 'geniebox_locale';

export function isLocale(value: unknown): value is Locale {
  return localeSchema.safeParse(value).success;
}
