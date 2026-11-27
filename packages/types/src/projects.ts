import { z } from 'zod';

/** Value lists shared with the backend (`project.constants.ts`). */
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
export const PROJECT_GOALS = [
  'more_clients',
  'less_churn',
  'faster_support',
  'less_routine',
  'tech_order',
] as const;
export const MAIN_METRICS = ['revenue', 'active_subscriptions', 'subscribers', 'uptime', 'custom'] as const;
export const CURRENCIES = ['RUB', 'USD', 'EUR', 'KZT'] as const;
export const NUMBER_FORMATS = ['space_comma', 'comma_dot'] as const;
export const DATE_FORMATS = ['dd.mm.yyyy', 'yyyy-mm-dd', 'mm/dd/yyyy'] as const;
export const WEEK_STARTS = ['monday', 'sunday'] as const;
export const CLIENT_LANGUAGES = ['ru', 'en', 'kk', 'uk'] as const;
export const CLIENT_TONES = ['friendly', 'business', 'neutral'] as const;
export const CLIENT_ADDRESSES = ['formal', 'informal'] as const;
export const TRUST_LEVELS = ['approve_all', 'approve_important', 'autonomous'] as const;
export const PROBATION_DAYS = [14, 30, 60] as const;
export const TRUST_STREAKS = [5, 10, 20] as const;
export const ALWAYS_ASK = [
  'discount_over_20',
  'mailing_over_500',
  'spend_over_10000',
  'release_changes',
  'publish_on_behalf',
] as const;
export const JOURNAL_RETENTION_DAYS = [90, 365, 1095] as const;
export const CLIENT_DATA_RETENTION_DAYS = [30, 90, 365] as const;

/** Full project with all settings (`GET …/projects/:id`). */
export const projectSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  sphere: z.enum(PROJECT_SPHERES).nullable(),
  about: z.string().nullable(),
  goals: z.array(z.enum(PROJECT_GOALS)),
  monthGoal: z.string().nullable(),
  mainMetric: z.enum(MAIN_METRICS),
  customMetric: z.string().nullable(),
  currency: z.enum(CURRENCIES),
  timezone: z.string(),
  numberFormat: z.enum(NUMBER_FORMATS),
  dateFormat: z.enum(DATE_FORMATS),
  weekStart: z.enum(WEEK_STARTS),
  clientLanguage: z.enum(CLIENT_LANGUAGES),
  clientTone: z.enum(CLIENT_TONES),
  clientAddress: z.enum(CLIENT_ADDRESSES),
  clientSignature: z.string().nullable(),
  defaultTrustLevel: z.enum(TRUST_LEVELS),
  probationDays: z.number(),
  trustStreak: z.number(),
  alwaysAsk: z.array(z.enum(ALWAYS_ASK)),
  agentRules: z.array(z.string()),
  aiBudgetMonthly: z.number(),
  plannedAgents: z.array(z.string()),
  journalRetentionDays: z.number(),
  clientDataRetentionDays: z.number(),
  agentsPaused: z.boolean(),
  pausedUntil: z.string().nullable(),
  onboardingStep: z.number().nullable(),
  onboardingCompletedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const projectUpdateSchema = z.object({
  name: z.string().optional(),
  sphere: z.enum(PROJECT_SPHERES).nullable().optional(),
  about: z.string().nullable().optional(),
  goals: z.array(z.enum(PROJECT_GOALS)).optional(),
  monthGoal: z.string().nullable().optional(),
  mainMetric: z.enum(MAIN_METRICS).optional(),
  customMetric: z.string().nullable().optional(),
  currency: z.enum(CURRENCIES).optional(),
  timezone: z.string().optional(),
  numberFormat: z.enum(NUMBER_FORMATS).optional(),
  dateFormat: z.enum(DATE_FORMATS).optional(),
  weekStart: z.enum(WEEK_STARTS).optional(),
  clientLanguage: z.enum(CLIENT_LANGUAGES).optional(),
  clientTone: z.enum(CLIENT_TONES).optional(),
  clientAddress: z.enum(CLIENT_ADDRESSES).optional(),
  clientSignature: z.string().nullable().optional(),
  journalRetentionDays: z.number().optional(),
  clientDataRetentionDays: z.number().optional(),
});

export const projectRulesUpdateSchema = z.object({
  defaultTrustLevel: z.enum(TRUST_LEVELS).optional(),
  probationDays: z.number().optional(),
  trustStreak: z.number().optional(),
  alwaysAsk: z.array(z.enum(ALWAYS_ASK)).optional(),
  agentRules: z.array(z.string()).optional(),
  aiBudgetMonthly: z.number().optional(),
});

export type Project = z.infer<typeof projectSchema>;
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>;
export type ProjectRulesUpdate = z.infer<typeof projectRulesUpdateSchema>;
