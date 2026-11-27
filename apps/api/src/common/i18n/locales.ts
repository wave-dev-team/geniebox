/** Product targets CIS: Russian is the fallback for every user-facing template. */
export const DEFAULT_LOCALE = 'ru';
export const SUPPORTED_LOCALES = ['ru', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
