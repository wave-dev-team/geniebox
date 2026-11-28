import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { ImportGroupResult } from '../import/connection-import.types.js';
import { ACCESS_LEVELS, type AccessLevel } from '../providers/provider.types.js';

const PROVIDER_KEY = /^[a-z][a-z0-9_]{1,40}$/;

/** The skeleton carries names and shapes only; values stay in the browser. */
export class ImportSkeletonDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Fragments with ids, line numbers, names, labels and value shapes',
  })
  @IsObject()
  skeleton: Record<string, unknown>;
}

export class ClarifyImportDto extends ImportSkeletonDto {
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @Length(0, 300)
  question?: string;

  @ApiProperty({ maxLength: 500, description: 'The person’s words, already stripped of values' })
  @IsString()
  @Length(1, 500)
  answer: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'The proposal being clarified',
  })
  @IsOptional()
  @IsObject()
  previous?: Record<string, unknown>;
}

export class ImportGroupDto {
  @ApiProperty({ example: 'yookassa' })
  @Matches(PROVIDER_KEY)
  providerKey: string;

  @ApiPropertyOptional({ enum: ACCESS_LEVELS, default: 'read' })
  @IsOptional()
  @IsIn(ACCESS_LEVELS)
  accessLevel?: AccessLevel;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  @IsObject()
  fields: Record<string, string>;
}

export class ImportConnectionsDto {
  @ApiProperty({ type: [ImportGroupDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ImportGroupDto)
  groups: ImportGroupDto[];

  @ApiPropertyOptional({ enum: ['skip', 'replace'], default: 'skip' })
  @IsOptional()
  @IsIn(['skip', 'replace'])
  mode?: 'skip' | 'replace';
}

export class ImportJobAcceptedDto {
  @ApiProperty({ format: 'uuid' })
  jobId: string;
}

export class ImportJobStatusDto {
  @ApiProperty({ enum: ['queued', 'running', 'done', 'failed'] })
  status: 'queued' | 'running' | 'done' | 'failed';

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  result: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, type: String })
  error: string | null;
}

export class ImportGroupResultDto {
  @ApiProperty()
  providerKey: string;

  @ApiProperty({ enum: ['created', 'replaced', 'skipped', 'unchanged', 'failed'] })
  outcome: ImportGroupResult['outcome'];

  @ApiProperty({ nullable: true, type: String })
  connectionId: string | null;

  @ApiProperty({ nullable: true, type: String })
  status: string | null;

  @ApiProperty({ nullable: true, type: String })
  masked: string | null;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  error: ImportGroupResult['error'];

  static from(result: ImportGroupResult): ImportGroupResultDto {
    return { ...result };
  }
}

export class ImportResponseDto {
  @ApiProperty({ type: [ImportGroupResultDto] })
  items: ImportGroupResultDto[];
}
