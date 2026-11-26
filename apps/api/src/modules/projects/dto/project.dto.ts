import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ACCOUNT_ROLES, type AccountRole } from '../../../common/auth/account-role.js';
import { IsTimeZone } from '../../../common/validation/is-time-zone.js';
import { SLUG_PATTERN } from '../../accounts/slug.js';
import {
  AGENT_TEMPLATE_PATTERN,
  ALWAYS_ASK,
  type AlwaysAsk,
  CLIENT_ADDRESSES,
  CLIENT_DATA_RETENTION_DAYS,
  CLIENT_LANGUAGES,
  CLIENT_TONES,
  type ClientAddress,
  type ClientLanguage,
  type ClientTone,
  CURRENCIES,
  type Currency,
  DATE_FORMATS,
  type DateFormat,
  JOURNAL_RETENTION_DAYS,
  MAIN_METRICS,
  type MainMetric,
  MAX_AGENT_RULE_LENGTH,
  MAX_AGENT_RULES,
  NUMBER_FORMATS,
  type NumberFormat,
  ONBOARDING_STEPS,
  PROBATION_DAYS,
  type ProbationDays,
  PROJECT_GOALS,
  PROJECT_SPHERES,
  type ProjectGoal,
  type ProjectSphere,
  TRUST_LEVELS,
  TRUST_STREAKS,
  type TrustLevel,
  type TrustStreak,
  WEEK_STARTS,
  type WeekStart,
} from '../project.constants.js';
import type { ProjectRow, ProjectWithRole } from '../repositories/projects.repository.js';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/** Empty strings clear optional text fields. */
const trimToNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const trimEach = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? value
        .map((item: unknown) => (typeof item === 'string' ? item.trim() : item))
        .filter((item: unknown) => item !== '')
    : value;

/** Fields of the first onboarding step, shared by create and update. */
class ProjectAboutFields {
  @ApiPropertyOptional({ enum: PROJECT_SPHERES, nullable: true })
  @IsOptional()
  @IsIn(PROJECT_SPHERES)
  sphere?: ProjectSphere | null;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(2000)
  about?: string | null;

  @ApiPropertyOptional({ enum: PROJECT_GOALS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(PROJECT_GOALS, { each: true })
  goals?: ProjectGoal[];
}

export class CreateProjectDto extends ProjectAboutFields {
  @ApiProperty({ example: 'SafeConnect VPN', maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiPropertyOptional({
    example: 'safeconnect',
    description: 'Generated from the name if omitted',
  })
  @IsOptional()
  @Matches(SLUG_PATTERN)
  slug?: string;
}

/** General settings, security and onboarding progress. Admin and above. */
export class UpdateProjectDto extends ProjectAboutFields {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ maxLength: 300, nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  monthGoal?: string | null;

  @ApiPropertyOptional({ enum: MAIN_METRICS })
  @IsOptional()
  @IsIn(MAIN_METRICS)
  mainMetric?: MainMetric;

  @ApiPropertyOptional({ maxLength: 100, nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  customMetric?: string | null;

  @ApiPropertyOptional({ enum: CURRENCIES })
  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: Currency;

  @ApiPropertyOptional({ example: 'Europe/Moscow', description: 'IANA time zone' })
  @IsOptional()
  @IsTimeZone()
  timezone?: string;

  @ApiPropertyOptional({ enum: NUMBER_FORMATS })
  @IsOptional()
  @IsIn(NUMBER_FORMATS)
  numberFormat?: NumberFormat;

  @ApiPropertyOptional({ enum: DATE_FORMATS })
  @IsOptional()
  @IsIn(DATE_FORMATS)
  dateFormat?: DateFormat;

  @ApiPropertyOptional({ enum: WEEK_STARTS })
  @IsOptional()
  @IsIn(WEEK_STARTS)
  weekStart?: WeekStart;

  @ApiPropertyOptional({ enum: CLIENT_LANGUAGES })
  @IsOptional()
  @IsIn(CLIENT_LANGUAGES)
  clientLanguage?: ClientLanguage;

  @ApiPropertyOptional({ enum: CLIENT_TONES })
  @IsOptional()
  @IsIn(CLIENT_TONES)
  clientTone?: ClientTone;

  @ApiPropertyOptional({ enum: CLIENT_ADDRESSES })
  @IsOptional()
  @IsIn(CLIENT_ADDRESSES)
  clientAddress?: ClientAddress;

  @ApiPropertyOptional({ maxLength: 200, nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(200)
  clientSignature?: string | null;

  @ApiPropertyOptional({ enum: JOURNAL_RETENTION_DAYS })
  @IsOptional()
  @IsIn(JOURNAL_RETENTION_DAYS)
  journalRetentionDays?: number;

  @ApiPropertyOptional({ enum: CLIENT_DATA_RETENTION_DAYS })
  @IsOptional()
  @IsIn(CLIENT_DATA_RETENTION_DAYS)
  clientDataRetentionDays?: number;

  @ApiPropertyOptional({
    description: 'Agent templates picked in onboarding; hired in a later step',
    isArray: true,
    type: String,
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @Matches(AGENT_TEMPLATE_PATTERN, { each: true })
  plannedAgents?: string[];

  @ApiPropertyOptional({
    minimum: 1,
    maximum: ONBOARDING_STEPS,
    description: 'Current onboarding step; finish with POST …/onboarding/complete',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(ONBOARDING_STEPS)
  onboardingStep?: number;
}

/** Rules for agents. Tech and above, per the role matrix. */
export class UpdateProjectRulesDto {
  @ApiPropertyOptional({ enum: TRUST_LEVELS })
  @IsOptional()
  @IsIn(TRUST_LEVELS)
  defaultTrustLevel?: TrustLevel;

  @ApiPropertyOptional({ enum: PROBATION_DAYS })
  @IsOptional()
  @IsIn(PROBATION_DAYS)
  probationDays?: ProbationDays;

  @ApiPropertyOptional({ enum: TRUST_STREAKS })
  @IsOptional()
  @IsIn(TRUST_STREAKS)
  trustStreak?: TrustStreak;

  @ApiPropertyOptional({ enum: ALWAYS_ASK, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(ALWAYS_ASK, { each: true })
  alwaysAsk?: AlwaysAsk[];

  @ApiPropertyOptional({
    isArray: true,
    type: String,
    description: 'Free-text rules passed to every agent',
    example: ['Никогда не упоминать конкурентов'],
  })
  @IsOptional()
  @Transform(trimEach)
  @IsArray()
  @ArrayMaxSize(MAX_AGENT_RULES)
  @IsString({ each: true })
  @MaxLength(MAX_AGENT_RULE_LENGTH, { each: true })
  agentRules?: string[];

  @ApiPropertyOptional({ minimum: 0, maximum: 100_000_000, description: 'Per month, whole units' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  aiBudgetMonthly?: number;
}

export class PauseProjectDto {
  @ApiPropertyOptional({
    description: 'Resume automatically at this time; omit to pause until resumed',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  until?: Date;
}

export class DeleteProjectDto {
  @ApiProperty({ description: 'Project name typed by the owner as confirmation' })
  @IsString()
  @MaxLength(120)
  confirmName: string;
}

export class ProjectResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  accountId: string;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: PROJECT_SPHERES, nullable: true })
  sphere: ProjectSphere | null;

  @ApiProperty({ nullable: true, type: String })
  about: string | null;

  @ApiProperty({ enum: PROJECT_GOALS, isArray: true })
  goals: ProjectGoal[];

  @ApiProperty({ nullable: true, type: String })
  monthGoal: string | null;

  @ApiProperty({ enum: MAIN_METRICS })
  mainMetric: MainMetric;

  @ApiProperty({ nullable: true, type: String })
  customMetric: string | null;

  @ApiProperty({ enum: CURRENCIES })
  currency: Currency;

  @ApiProperty()
  timezone: string;

  @ApiProperty({ enum: NUMBER_FORMATS })
  numberFormat: NumberFormat;

  @ApiProperty({ enum: DATE_FORMATS })
  dateFormat: DateFormat;

  @ApiProperty({ enum: WEEK_STARTS })
  weekStart: WeekStart;

  @ApiProperty({ enum: CLIENT_LANGUAGES })
  clientLanguage: ClientLanguage;

  @ApiProperty({ enum: CLIENT_TONES })
  clientTone: ClientTone;

  @ApiProperty({ enum: CLIENT_ADDRESSES })
  clientAddress: ClientAddress;

  @ApiProperty({ nullable: true, type: String })
  clientSignature: string | null;

  @ApiProperty({ enum: TRUST_LEVELS })
  defaultTrustLevel: TrustLevel;

  @ApiProperty({ enum: PROBATION_DAYS })
  probationDays: ProbationDays;

  @ApiProperty({ enum: TRUST_STREAKS })
  trustStreak: TrustStreak;

  @ApiProperty({ enum: ALWAYS_ASK, isArray: true })
  alwaysAsk: AlwaysAsk[];

  @ApiProperty({ isArray: true, type: String })
  agentRules: string[];

  @ApiProperty()
  aiBudgetMonthly: number;

  @ApiProperty({ isArray: true, type: String })
  plannedAgents: string[];

  @ApiProperty({ enum: JOURNAL_RETENTION_DAYS })
  journalRetentionDays: number;

  @ApiProperty({ enum: CLIENT_DATA_RETENTION_DAYS })
  clientDataRetentionDays: number;

  @ApiProperty({ description: 'Project kill switch: agents do nothing while true' })
  agentsPaused: boolean;

  @ApiProperty({ nullable: true, type: Date })
  pausedUntil: Date | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: '1–5 during onboarding, null when done',
  })
  onboardingStep: number | null;

  @ApiProperty({ nullable: true, type: Date })
  onboardingCompletedAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  static from(row: ProjectRow): ProjectResponseDto {
    return {
      id: row.id,
      accountId: row.account_id,
      slug: row.slug,
      name: row.name,
      sphere: row.sphere as ProjectSphere | null,
      about: row.about,
      goals: row.goals as ProjectGoal[],
      monthGoal: row.month_goal,
      mainMetric: row.main_metric as MainMetric,
      customMetric: row.custom_metric,
      currency: row.currency as Currency,
      timezone: row.timezone,
      numberFormat: row.number_format as NumberFormat,
      dateFormat: row.date_format as DateFormat,
      weekStart: row.week_start as WeekStart,
      clientLanguage: row.client_language as ClientLanguage,
      clientTone: row.client_tone as ClientTone,
      clientAddress: row.client_address as ClientAddress,
      clientSignature: row.client_signature,
      defaultTrustLevel: row.default_trust_level as TrustLevel,
      probationDays: row.probation_days as ProbationDays,
      trustStreak: row.trust_streak as TrustStreak,
      alwaysAsk: row.always_ask as AlwaysAsk[],
      agentRules: row.agent_rules,
      aiBudgetMonthly: row.ai_budget_monthly,
      plannedAgents: row.planned_agents,
      journalRetentionDays: row.journal_retention_days,
      clientDataRetentionDays: row.client_data_retention_days,
      agentsPaused: row.agents_paused,
      pausedUntil: row.paused_until,
      onboardingStep: row.onboarding_step,
      onboardingCompletedAt: row.onboarding_completed_at,
      createdAt: row.created_at,
    };
  }
}

export class AccountBlockDto {
  @ApiProperty()
  at: Date;

  @ApiProperty({ description: 'Why the account was blocked' })
  reason: string;
}

/** Entry of the project switcher: projects from every account of the user. */
export class MyProjectResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  accountId: string;

  @ApiProperty()
  accountName: string;

  @ApiProperty({ enum: ACCOUNT_ROLES, description: 'Role of the current user in the account' })
  role: AccountRole;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: PROJECT_SPHERES, nullable: true })
  sphere: ProjectSphere | null;

  @ApiProperty()
  agentsPaused: boolean;

  @ApiProperty({ nullable: true, type: Number })
  onboardingStep: number | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({
    nullable: true,
    type: AccountBlockDto,
    description: 'Set when the platform blocked the account: the app shows only this',
  })
  accountBlocked: AccountBlockDto | null;

  static from(row: ProjectWithRole): MyProjectResponseDto {
    return {
      id: row.id,
      accountId: row.account_id,
      accountName: row.account_name,
      role: row.role,
      slug: row.slug,
      name: row.name,
      sphere: row.sphere as ProjectSphere | null,
      agentsPaused: row.agents_paused,
      onboardingStep: row.onboarding_step,
      createdAt: row.created_at,
      accountBlocked: row.account_blocked_at
        ? { at: row.account_blocked_at, reason: row.account_blocked_reason ?? '' }
        : null,
    };
  }
}
