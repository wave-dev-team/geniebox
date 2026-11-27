import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  KNOWLEDGE_NODE_KINDS,
  KNOWLEDGE_PROPOSAL_STATUSES,
  KNOWLEDGE_SOURCE_STATUSES,
  KNOWLEDGE_STATUSES,
  type KnowledgeNodeKind,
  type KnowledgeProposalStatus,
  type KnowledgeSourceStatus,
  type KnowledgeStatus,
} from '../knowledge.constants.js';
import type { NodeRow, ProposalRow, RevisionRow, SourceRow } from '../repositories/knowledge.repository.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateNodeDto {
  @ApiProperty({ enum: KNOWLEDGE_NODE_KINDS, default: 'page' })
  @IsIn(KNOWLEDGE_NODE_KINDS)
  kind: KnowledgeNodeKind;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Transform(trim)
  title: string;

  @ApiPropertyOptional({ description: 'Markdown; pages only', maxLength: 200_000 })
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  body?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}

export class UpdateNodeDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Transform(trim)
  title?: string;

  @ApiPropertyOptional({ maxLength: 200_000 })
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  body?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'null moves to the root' })
  @IsOptional()
  @ValidateIf((value: UpdateNodeDto) => value.parentId !== null)
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  position?: number;
}

export class TreeQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Children of this folder; omit for the whole tree' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ enum: KNOWLEDGE_STATUSES })
  @IsOptional()
  @IsIn(KNOWLEDGE_STATUSES)
  status?: KnowledgeStatus;
}

export class KnowledgeNodeDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  parentId: string | null;

  @ApiProperty({ enum: KNOWLEDGE_NODE_KINDS })
  kind: KnowledgeNodeKind;

  @ApiProperty()
  title: string;

  @ApiProperty()
  body: string;

  @ApiProperty({ enum: KNOWLEDGE_STATUSES })
  status: KnowledgeStatus;

  @ApiProperty()
  position: number;

  @ApiProperty({ format: 'uuid', nullable: true })
  sourceId: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  publishedAt: string | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  static from(row: NodeRow): KnowledgeNodeDto {
    return {
      id: row.id,
      parentId: row.parent_id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      status: row.status,
      position: row.position,
      sourceId: row.source_id,
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}

export class CreateSourceDto {
  @ApiProperty({ enum: ['upload', 'text'], default: 'upload' })
  @IsIn(['upload', 'text'])
  kind: 'upload' | 'text';

  @ApiPropertyOptional({ maxLength: 200, description: 'Defaults to the file name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trim)
  title?: string;

  @ApiPropertyOptional({ maxLength: 200, description: 'Original file name, defines the format' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  filename?: string;

  @ApiPropertyOptional({ description: 'File bytes, base64. Uploads only.' })
  @IsOptional()
  @IsString()
  @MaxLength(30_000_000)
  contentBase64?: string;

  @ApiPropertyOptional({ description: 'Markdown or plain text. Text sources only.', maxLength: 200_000 })
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  text?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Start of the data period of the source' })
  @IsOptional()
  @IsISO8601({ strict: true })
  periodStart?: string;

  @ApiPropertyOptional({ format: 'date', description: 'End of the data period of the source' })
  @IsOptional()
  @IsISO8601({ strict: true })
  periodEnd?: string;

  @ApiPropertyOptional({
    description: '{"sample", "segment", "method", "confidence", "limitations": [...]}',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class SourcesQueryDto {
  @ApiPropertyOptional({ enum: KNOWLEDGE_SOURCE_STATUSES })
  @IsOptional()
  @IsIn(KNOWLEDGE_SOURCE_STATUSES)
  status?: KnowledgeSourceStatus;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class KnowledgeSourceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: ['upload', 'text'] })
  kind: string;

  @ApiProperty({ nullable: true, type: String })
  mime: string | null;

  @ApiProperty()
  sizeBytes: number;

  @ApiProperty({ enum: KNOWLEDGE_SOURCE_STATUSES })
  status: KnowledgeSourceStatus;

  @ApiProperty({ nullable: true, type: String })
  error: string | null;

  @ApiProperty({ format: 'date', nullable: true })
  periodStart: string | null;

  @ApiProperty({ format: 'date', nullable: true })
  periodEnd: string | null;

  @ApiProperty({ type: Object })
  metadata: Record<string, unknown>;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  static from(row: SourceRow): KnowledgeSourceDto {
    return {
      id: row.id,
      title: row.title,
      kind: row.kind,
      mime: row.mime,
      sizeBytes: Number(row.size_bytes),
      status: row.status,
      error: row.error,
      periodStart: row.period_start ? String(row.period_start).slice(0, 10) : null,
      periodEnd: row.period_end ? String(row.period_end).slice(0, 10) : null,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }
}

export class SearchQueryDto {
  @ApiProperty({ description: 'Question or keywords', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Transform(trim)
  q: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Search inside this folder only' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 10, default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}

export class RevisionDto {
  @ApiProperty()
  revision: number;

  @ApiProperty()
  title: string;

  @ApiProperty()
  body: string;

  @ApiProperty({ enum: KNOWLEDGE_STATUSES })
  status: KnowledgeStatus;

  @ApiProperty({ enum: ['user', 'agent', 'system'] })
  authorKind: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  authorId: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  static from(row: RevisionRow): RevisionDto {
    return {
      revision: row.revision,
      title: row.title,
      body: row.body,
      status: row.status as KnowledgeStatus,
      authorKind: row.author_kind,
      authorId: row.author_id,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }
}

export class ProposalsQueryDto {
  @ApiPropertyOptional({ enum: KNOWLEDGE_PROPOSAL_STATUSES })
  @IsOptional()
  @IsIn(KNOWLEDGE_PROPOSAL_STATUSES)
  status?: KnowledgeProposalStatus;
}

export class ProposalDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  agentId: string;

  @ApiProperty({ enum: ['create', 'edit', 'gap'] })
  kind: string;

  @ApiProperty({ enum: KNOWLEDGE_PROPOSAL_STATUSES })
  status: KnowledgeProposalStatus;

  @ApiProperty({ type: Object })
  payload: Record<string, unknown>;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  static from(row: ProposalRow): ProposalDto {
    return {
      id: row.id,
      agentId: row.agent_id,
      kind: row.kind,
      status: row.status,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }
}

export class KnowledgeStatsDto {
  @ApiProperty()
  drafts: number;

  @ApiProperty()
  published: number;

  @ApiProperty()
  failedSources: number;

  @ApiProperty()
  openProposals: number;

  @ApiProperty()
  chunks: number;

  @ApiProperty({ description: 'Whether vector search is on for this deployment' })
  embeddings: boolean;
}
