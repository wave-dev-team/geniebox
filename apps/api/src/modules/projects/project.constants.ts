/** Value lists for project fields. The database checks the same lists (migration 202610220000). */

export const PROJECT_SPHERES = [
  'subscription',
  'ecommerce',
  'online_school',
  'saas',
  'services',
  'media',
  'personal',
  'open_source',
  'other',
] as const;
export type ProjectSphere = (typeof PROJECT_SPHERES)[number];

/** Onboarding goals; they drive the recommended team. */
export const PROJECT_GOALS = [
  'more_clients',
  'less_churn',
  'faster_support',
  'less_routine',
  'tech_order',
] as const;
export type ProjectGoal = (typeof PROJECT_GOALS)[number];

export const MAIN_METRICS = ['revenue', 'active_subscriptions', 'subscribers', 'uptime', 'custom'] as const;
export type MainMetric = (typeof MAIN_METRICS)[number];

export const CURRENCIES = ['RUB', 'USD', 'EUR', 'KZT'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** `space_comma` = 1 234,56; `comma_dot` = 1,234.56. */
export const NUMBER_FORMATS = ['space_comma', 'comma_dot'] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

export const DATE_FORMATS = ['dd.mm.yyyy', 'yyyy-mm-dd', 'mm/dd/yyyy'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const WEEK_STARTS = ['monday', 'sunday'] as const;
export type WeekStart = (typeof WEEK_STARTS)[number];

export const CLIENT_LANGUAGES = ['ru', 'en', 'kk', 'uk'] as const;
export type ClientLanguage = (typeof CLIENT_LANGUAGES)[number];

export const CLIENT_TONES = ['friendly', 'business', 'neutral'] as const;
export type ClientTone = (typeof CLIENT_TONES)[number];

/** Russian «вы» / «ты». */
export const CLIENT_ADDRESSES = ['formal', 'informal'] as const;
export type ClientAddress = (typeof CLIENT_ADDRESSES)[number];

export const TRUST_LEVELS = ['approve_all', 'approve_important', 'autonomous'] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

export const PROBATION_DAYS = [14, 30, 60] as const;
export type ProbationDays = (typeof PROBATION_DAYS)[number];

/** Successful actions in a row after which the manager suggests raising trust. */
export const TRUST_STREAKS = [5, 10, 20] as const;
export type TrustStreak = (typeof TRUST_STREAKS)[number];

/** «Всегда спрашивать»: actions that always become a decision. */
export const ALWAYS_ASK = [
  'discount_over_20',
  'mailing_over_500',
  'spend_over_10000',
  'release_changes',
  'publish_on_behalf',
] as const;
export type AlwaysAsk = (typeof ALWAYS_ASK)[number];

export const JOURNAL_RETENTION_DAYS = [90, 365, 1095] as const;
export const CLIENT_DATA_RETENTION_DAYS = [30, 90, 365] as const;

export const ONBOARDING_STEPS = 5;

/** Agent template keys offered in onboarding. */
export const AGENT_TEMPLATE_PATTERN = /^[a-z][a-z0-9_-]{1,40}$/;

export const MAX_AGENT_RULES = 50;
export const MAX_AGENT_RULE_LENGTH = 300;
