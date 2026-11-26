import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { DecisionRow } from '../repositories/decisions.repository.js';
import { DECISION_STATUSES, type DecisionStatus, type Risk, RISKS } from '../work.constants.js';
import { FactDto } from './common.dto.js';

export class TermOptionDto {
  @ApiProperty({ example: '30' })
  value: string;

  @ApiProperty({ example: '30%' })
  label: string;

  @ApiProperty({ nullable: true, type: String, example: '≈ +18 000 ₽/мес' })
  effect: string | null;

  @ApiProperty({ nullable: true, type: String, example: '≈ 5 400 ₽ скидки' })
  cost: string | null;
}

export class DecisionTermsDto {
  @ApiProperty({ example: 'Скидка' })
  label: string;

  @ApiProperty({ description: 'Value the agent proposed' })
  proposed: string;

  @ApiProperty({ type: [TermOptionDto] })
  options: TermOptionDto[];
}

export class DecisionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  agentId: string;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  taskId: string | null;

  @ApiProperty()
  title: string;

  @ApiProperty({ nullable: true, type: String })
  meta: string | null;

  @ApiProperty({ nullable: true, type: String, example: '≈ +18 000 ₽/мес' })
  effect: string | null;

  @ApiProperty({ nullable: true, type: String })
  cost: string | null;

  @ApiProperty({ enum: RISKS })
  risk: Risk;

  @ApiProperty({ nullable: true, type: String })
  riskNote: string | null;

  @ApiProperty({ type: [String] })
  why: string[];

  @ApiProperty({ type: [FactDto] })
  plan: FactDto[];

  @ApiProperty({ nullable: true, type: DecisionTermsDto })
  terms: DecisionTermsDto | null;

  @ApiProperty({ nullable: true, type: String })
  selectedTerm: string | null;

  @ApiProperty()
  yesLabel: string;

  @ApiProperty({ nullable: true, type: String })
  yesText: string | null;

  @ApiProperty({ enum: DECISION_STATUSES })
  status: DecisionStatus;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  decidedBy: string | null;

  @ApiProperty({ nullable: true, type: Date })
  decidedAt: Date | null;

  @ApiProperty({ nullable: true, enum: ['web'] })
  decidedVia: 'web' | null;

  @ApiProperty({ nullable: true, type: Date })
  cooldownUntil: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  expiresAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  static from(row: DecisionRow): DecisionResponseDto {
    return {
      id: row.id,
      agentId: row.agent_id,
      taskId: row.task_id,
      title: row.title,
      meta: row.meta,
      effect: row.effect,
      cost: row.cost,
      risk: row.risk,
      riskNote: row.risk_note,
      why: row.why,
      plan: row.plan,
      terms: row.terms,
      selectedTerm: row.selected_term,
      yesLabel: row.yes_label,
      yesText: row.yes_text,
      status: row.status,
      decidedBy: row.decided_by,
      decidedAt: row.decided_at,
      decidedVia: 'web',
      cooldownUntil: row.cooldown_until,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }
}

export class DecisionListQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'decided', 'all'], default: 'pending' })
  @IsOptional()
  @IsIn(['pending', 'decided', 'all'])
  tab?: 'pending' | 'decided' | 'all';
}

export class AcceptDecisionDto {
  @ApiPropertyOptional({ description: 'Chosen term value; defaults to the proposed one' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  term?: string;
}

export class RejectDecisionDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class DecisionCountsDto {
  @ApiProperty()
  pending: number;

  @ApiProperty()
  decided: number;
}
