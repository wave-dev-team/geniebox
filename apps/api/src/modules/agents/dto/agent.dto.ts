import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { type CatalogVersion, versionToolIds } from '../../catalog/catalog.service.js';
import {
  PLAN_KEYS,
  requirementTextsFor,
  TEMPLATE_CATEGORIES,
  type TemplateCategory,
  textsFor,
} from '../../catalog/catalog-content.js';
import { PROJECT_GOALS } from '../../projects/project.constants.js';
import type { AgentDetails, EffectivePermission } from '../agents.service.js';
import {
  ASKS,
  LIMIT_KINDS,
  PERMISSION_MODES,
  type PermissionMode,
  RISK_CLASSES,
  type RiskClass,
  SKILLS,
  TOOLS,
} from '../catalog/catalog.js';
import type { AgentConnectionView, AgentRow } from '../repositories/agents.repository.js';

const TRUST_LEVELS = ['approve_all', 'approve_important', 'autonomous'] as const;
const ACCESS = ['read', 'read_write'] as const;
const STATUSES = ['active', 'probation', 'paused'] as const;
const ICON_KINDS = ['glyph', 'emoji', 'image'] as const;
const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

// --- catalog ---------------------------------------------------------------------------------

export class RequirementDto {
  @ApiProperty({ example: 'payments' })
  key: string;

  @ApiProperty()
  required: boolean;

  @ApiProperty({ isArray: true, type: String, description: 'Any of these providers fits' })
  providers: string[];

  @ApiProperty({ example: 'Платежи', description: 'In the request language' })
  title: string;

  @ApiProperty({ description: 'Why the agent needs this data; may be empty' })
  purpose: string;
}

export class TemplateAsksDto {
  @ApiProperty({ enum: ASKS, isArray: true })
  offered: string[];

  @ApiProperty({ enum: ASKS, isArray: true })
  defaults: string[];
}

export class TemplateAbilityDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  text: string;
}

export class TemplateOnboardingDto {
  @ApiProperty({ description: 'Offered in onboarding step «Команда»' })
  offered: boolean;

  @ApiProperty({ enum: PROJECT_GOALS, isArray: true, description: '«Рекомендуем» for these goals' })
  goals: string[];
}

export class AgentTemplateDto {
  @ApiProperty({ example: 'marketer' })
  key: string;

  @ApiProperty({ description: 'Published catalog version' })
  version: number;

  @ApiProperty({ enum: TEMPLATE_CATEGORIES })
  category: TemplateCategory;

  @ApiProperty({ description: 'Glyph key of the frontend icon set' })
  icon: string;

  @ApiProperty({ description: 'In the request language' })
  name: string;

  @ApiProperty({ description: 'Short role in the team' })
  role: string;

  @ApiProperty({ description: 'One line under the name' })
  short: string;

  @ApiProperty({ description: 'Marketplace card text' })
  description: string;

  @ApiProperty({ type: [TemplateAbilityDto] })
  abilities: TemplateAbilityDto[];

  @ApiProperty({ description: 'Per month, whole roubles; 0 = only the AI budget' })
  price: number;

  @ApiProperty()
  trialDays: number;

  @ApiProperty({ enum: PLAN_KEYS, isArray: true, description: 'Plans it can be hired on' })
  plans: string[];

  @ApiProperty({
    description:
      "In this account's marketplace (published for all or a beta it is in); hidden ones keep names of hired agents",
  })
  listed: boolean;

  @ApiProperty({ description: 'Published to selected accounts only' })
  beta: boolean;

  @ApiProperty({ enum: TRUST_LEVELS })
  defaultTrust: string;

  @ApiProperty({ type: TemplateOnboardingDto })
  onboarding: TemplateOnboardingDto;

  @ApiProperty({ type: [RequirementDto] })
  requirements: RequirementDto[];

  @ApiProperty({
    isArray: true,
    type: String,
    description: 'Catalog tools of the role, plus the system-closed ones (always «deny»)',
  })
  tools: string[];

  @ApiProperty({ type: TemplateAsksDto })
  asks: TemplateAsksDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: { oneOf: [{ type: 'number' }, { type: 'string' }] },
  })
  limits: Record<string, number | string>;

  static from(
    version: CatalogVersion,
    meta: { locale: string; listed: boolean; beta: boolean },
  ): AgentTemplateDto {
    const content = version.content;
    const texts = textsFor(content, meta.locale);
    return {
      key: version.key,
      version: version.number,
      category: version.category,
      icon: version.icon,
      name: texts.name,
      role: texts.role,
      short: texts.short,
      description: texts.description,
      abilities: texts.abilities.map((a) => ({ name: a.name, text: a.text })),
      price: content.price,
      trialDays: content.trialDays,
      plans: [...content.plans],
      listed: meta.listed,
      beta: meta.beta,
      defaultTrust: content.defaultTrust,
      onboarding: { offered: content.onboarding.offered, goals: [...content.onboarding.goals] },
      requirements: content.requirements.map((r) => ({
        key: r.key,
        required: r.required,
        providers: [...r.providers],
        ...requirementTextsFor(r, meta.locale),
      })),
      tools: [
        ...versionToolIds(version),
        ...TOOLS.filter((tool) => tool.systemDenied).map((tool) => tool.id),
      ],
      asks: { offered: [...content.asks.offered], defaults: [...content.asks.defaults] },
      limits: { ...(content.limits as Record<string, number | string>) },
    };
  }
}

export class ToolDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: RISK_CLASSES })
  risk: RiskClass;

  @ApiProperty()
  systemDenied: boolean;
}

export class LimitKindDto {
  @ApiProperty()
  kind: string;

  @ApiProperty({ enum: ['rub', 'count', 'time_range'] })
  unit: 'rub' | 'count' | 'time_range';
}

export class AgentCatalogDto {
  @ApiProperty({ type: [AgentTemplateDto] })
  templates: AgentTemplateDto[];

  @ApiProperty({ type: [ToolDto] })
  tools: ToolDto[];

  @ApiProperty({ enum: ASKS, isArray: true })
  asks: string[];

  @ApiProperty({ type: [LimitKindDto] })
  limitKinds: LimitKindDto[];

  @ApiProperty({
    enum: SKILLS,
    isArray: true,
    description: 'Built-in skills, on for every project',
  })
  skills: string[];

  static build(templates: AgentTemplateDto[]): AgentCatalogDto {
    return {
      templates,
      tools: TOOLS.map((tool) => ({
        id: tool.id,
        risk: tool.risk,
        systemDenied: tool.systemDenied ?? false,
      })),
      asks: [...ASKS],
      limitKinds: Object.entries(LIMIT_KINDS).map(([kind, def]) => ({ kind, unit: def.unit })),
      skills: [...SKILLS],
    };
  }
}

export class CatalogQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Account whose marketplace to show (betas it is in); membership is checked',
  })
  @IsOptional()
  @IsUUID()
  accountId?: string;
}

// --- requests --------------------------------------------------------------------------------

export class AgentIconDto {
  @ApiProperty({ enum: ['glyph', 'emoji'] })
  @IsIn(['glyph', 'emoji'])
  kind: 'glyph' | 'emoji';

  @ApiProperty({ example: 'growth', description: 'Glyph key or emoji' })
  @IsString()
  @Length(1, 30)
  value: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: 'chart-1',
    description: 'Background token',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  bg?: string | null;
}

export class AgentConnectionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  connectionId: string;

  @ApiProperty({ enum: ACCESS })
  @IsIn(ACCESS)
  accessLevel: 'read' | 'read_write';
}

export class CustomAgentDto {
  @ApiProperty({ maxLength: 60 })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  roleText?: string;

  @ApiProperty({ type: AgentIconDto })
  @ValidateNested()
  @Type(() => AgentIconDto)
  icon: AgentIconDto;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  instructions?: string;
}

export class HireAgentDto {
  @ApiPropertyOptional({
    example: 'marketer',
    description: 'Catalog template; omit for a custom agent',
  })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]{1,40}$/)
  templateKey?: string;

  @ApiPropertyOptional({
    type: CustomAgentDto,
    description: 'Custom agent instead of a template',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomAgentDto)
  custom?: CustomAgentDto;

  @ApiProperty({ type: [AgentConnectionDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AgentConnectionDto)
  connections: AgentConnectionDto[];

  @ApiPropertyOptional({ enum: TRUST_LEVELS, description: 'Defaults to the project rule' })
  @IsOptional()
  @IsIn(TRUST_LEVELS)
  trustLevel?: (typeof TRUST_LEVELS)[number];
}

export class UpdateAgentDto {
  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  displayName?: string;

  @ApiPropertyOptional({ maxLength: 80, nullable: true, type: String })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value))
  @IsString()
  @MaxLength(80)
  roleText?: string | null;

  @ApiPropertyOptional({ type: AgentIconDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AgentIconDto)
  icon?: AgentIconDto;

  @ApiPropertyOptional({ enum: TRUST_LEVELS })
  @IsOptional()
  @IsIn(TRUST_LEVELS)
  trustLevel?: (typeof TRUST_LEVELS)[number];
}

export class InstructionDto {
  @ApiProperty({ maxLength: 60, example: 'Тон' })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  topic: string;

  @ApiProperty({ maxLength: 500, example: 'на «вы», коротко, без эмодзи' })
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  rule: string;
}

export class UpdateAgentRulesDto {
  @ApiPropertyOptional({ type: [InstructionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => InstructionDto)
  instructions?: InstructionDto[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { oneOf: [{ type: 'number' }, { type: 'string' }] },
    description: 'Limit kind → value (roubles, count or HH:MM-HH:MM)',
  })
  @IsOptional()
  @IsObject()
  limits?: Record<string, number | string>;

  @ApiPropertyOptional({ enum: ASKS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  asks?: string[];
}

export class PermissionChangeDto {
  @ApiProperty({ example: 'bot.broadcast' })
  @Matches(/^[a-z][a-z0-9_.]{1,60}$/)
  actionId: string;

  @ApiProperty({
    enum: PERMISSION_MODES,
    nullable: true,
    description: 'null = back to the trust preset',
  })
  @IsOptional()
  @IsIn([...PERMISSION_MODES, null])
  mode: PermissionMode | null;
}

export class SetPermissionsDto {
  @ApiProperty({ type: [PermissionChangeDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PermissionChangeDto)
  items: PermissionChangeDto[];
}

export class SetAgentConnectionsDto {
  @ApiProperty({ type: [AgentConnectionDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AgentConnectionDto)
  connections: AgentConnectionDto[];
}

export class PauseAgentDto {
  @ApiPropertyOptional({ description: 'Resume automatically at this time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  until?: Date;
}

// --- responses -------------------------------------------------------------------------------

export class AgentIconResponseDto {
  @ApiProperty({ enum: ICON_KINDS })
  kind: (typeof ICON_KINDS)[number];

  @ApiProperty()
  value: string;

  @ApiProperty({ nullable: true, type: String })
  bg: string | null;
}

export class AgentConnectionResponseDto {
  @ApiProperty({ format: 'uuid' })
  connectionId: string;

  @ApiProperty()
  providerKey: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: ['pending', 'ok', 'warn', 'error'] })
  status: string;

  @ApiProperty({ enum: ACCESS })
  accessLevel: 'read' | 'read_write';

  @ApiProperty({ enum: ACCESS, description: 'Level of the connection itself (the ceiling)' })
  connectionAccessLevel: 'read' | 'read_write';

  static from(view: AgentConnectionView): AgentConnectionResponseDto {
    return {
      connectionId: view.connectionId,
      providerKey: view.providerKey,
      name: view.name,
      status: view.status,
      accessLevel: view.accessLevel as 'read' | 'read_write',
      connectionAccessLevel: view.connectionAccessLevel as 'read' | 'read_write',
    };
  }
}

export class InstructionResponseDto {
  @ApiProperty()
  topic: string;

  @ApiProperty()
  rule: string;
}

export class AgentSummaryDto {
  @ApiProperty()
  actionsWeek: number;

  @ApiProperty()
  tasksActive: number;

  @ApiProperty()
  tasksDone: number;

  @ApiProperty({ nullable: true, type: Date })
  lastActionAt: Date | null;

  @ApiProperty({ nullable: true, type: Number })
  acceptedPct: number | null;
}

const EMPTY_SUMMARY: AgentSummaryDto = {
  actionsWeek: 0,
  tasksActive: 0,
  tasksDone: 0,
  lastActionAt: null,
  acceptedPct: null,
};

export class AgentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ['manager', 'agent'] })
  kind: 'manager' | 'agent';

  @ApiProperty({ nullable: true, type: String })
  templateKey: string | null;

  @ApiProperty()
  displayName: string;

  @ApiProperty({ nullable: true, type: String })
  roleText: string | null;

  @ApiProperty({ type: AgentIconResponseDto })
  icon: AgentIconResponseDto;

  @ApiProperty({ enum: STATUSES })
  status: (typeof STATUSES)[number];

  @ApiProperty({ nullable: true, type: Date })
  probationUntil: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  pausedUntil: Date | null;

  @ApiProperty({ enum: TRUST_LEVELS })
  trustLevel: (typeof TRUST_LEVELS)[number];

  @ApiProperty({ type: [InstructionResponseDto] })
  instructions: InstructionResponseDto[];

  @ApiProperty({
    type: 'object',
    additionalProperties: { oneOf: [{ type: 'number' }, { type: 'string' }] },
  })
  limits: Record<string, number | string>;

  @ApiProperty({ isArray: true, type: String })
  asks: string[];

  @ApiProperty({ type: [AgentConnectionResponseDto] })
  connections: AgentConnectionResponseDto[];

  @ApiProperty()
  hiredAt: Date;

  @ApiProperty({ type: AgentSummaryDto })
  summary: AgentSummaryDto;

  static from(
    agent: AgentRow,
    connections: AgentConnectionView[],
    summary: AgentSummaryDto = EMPTY_SUMMARY,
  ): AgentResponseDto {
    return {
      id: agent.id,
      kind: agent.kind as AgentResponseDto['kind'],
      templateKey: agent.template_key,
      displayName: agent.display_name,
      roleText: agent.role_text,
      icon: {
        kind: agent.icon_kind as AgentIconResponseDto['kind'],
        value: agent.icon_value,
        bg: agent.icon_bg,
      },
      status: agent.status as AgentResponseDto['status'],
      probationUntil: agent.probation_until,
      pausedUntil: agent.paused_until,
      trustLevel: agent.trust_level as AgentResponseDto['trustLevel'],
      instructions: agent.instructions,
      limits: agent.limits,
      asks: agent.asks,
      connections: connections.map((c) => AgentConnectionResponseDto.from(c)),
      hiredAt: agent.hired_at,
      summary,
    };
  }
}

export class EffectivePermissionDto {
  @ApiProperty()
  actionId: string;

  @ApiProperty({ enum: RISK_CLASSES })
  risk: RiskClass;

  @ApiProperty({ enum: PERMISSION_MODES })
  mode: PermissionMode;

  @ApiProperty({ enum: ['preset', 'explicit', 'system'] })
  source: 'preset' | 'explicit' | 'system';

  @ApiProperty({ description: 'Closed in the system; cannot be changed' })
  locked: boolean;

  static from(permission: EffectivePermission): EffectivePermissionDto {
    return { ...permission };
  }
}

export class AgentNoteDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  text: string;

  @ApiProperty()
  createdAt: Date;
}

export class AgentTemplateSummaryDto {
  @ApiProperty()
  key: string;

  @ApiProperty()
  version: number;

  @ApiProperty({ enum: TEMPLATE_CATEGORIES })
  category: TemplateCategory;

  @ApiProperty()
  icon: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  role: string;

  @ApiProperty()
  short: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ type: [TemplateAbilityDto] })
  abilities: TemplateAbilityDto[];

  @ApiProperty({ type: [RequirementDto] })
  requirements: RequirementDto[];

  @ApiProperty({ isArray: true, type: String })
  tools: string[];

  static fromVersion(version: CatalogVersion, locale = 'ru'): AgentTemplateSummaryDto {
    const dto = AgentTemplateDto.from(version, { locale, listed: true, beta: false });
    return {
      key: dto.key,
      version: dto.version,
      category: dto.category,
      icon: dto.icon,
      name: dto.name,
      role: dto.role,
      short: dto.short,
      description: dto.description,
      abilities: dto.abilities,
      requirements: dto.requirements,
      tools: dto.tools,
    };
  }
}

export class AgentDetailsDto extends AgentResponseDto {
  @ApiProperty({ type: [EffectivePermissionDto] })
  permissions: EffectivePermissionDto[];

  @ApiProperty({ type: [AgentNoteDto] })
  notes: AgentNoteDto[];

  @ApiProperty({ isArray: true, type: String, description: 'Project rules: always on' })
  enforcedAsks: string[];

  @ApiProperty({ nullable: true, type: AgentTemplateSummaryDto })
  template: AgentTemplateSummaryDto | null;

  static fromDetails(details: AgentDetails): AgentDetailsDto {
    return {
      ...AgentResponseDto.from(details.agent, details.connections),
      permissions: details.permissions.map((p) => EffectivePermissionDto.from(p)),
      notes: details.notes.map((n) => ({ id: n.id, text: n.text, createdAt: n.created_at })),
      enforcedAsks: details.enforcedAsks,
      template: details.template,
    };
  }
}

export const AGENT_ACTION_TYPES = ['tool', 'task', 'decision', 'insight', 'note', 'admin'] as const;
export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number];

export class AgentActionsQueryDto {
  @ApiPropertyOptional({ enum: ['7d', '30d'], default: '7d' })
  @IsOptional()
  @IsIn(['7d', '30d'])
  period?: '7d' | '30d';

  @ApiPropertyOptional({ description: 'Comma-separated action types' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  types?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{8,160}$/)
  cursor?: string;
}

export class AgentActionItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: AGENT_ACTION_TYPES })
  type: AgentActionType;

  @ApiProperty({ format: 'date-time' })
  at: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  details: string;

  @ApiProperty()
  status: string;

  @ApiProperty({ nullable: true, type: String })
  targetId: string | null;

  @ApiProperty({ nullable: true, type: String })
  taskId: string | null;
}

export class AgentActionPageDto {
  @ApiProperty({ type: [AgentActionItemDto] })
  items: AgentActionItemDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor: string | null;
}
