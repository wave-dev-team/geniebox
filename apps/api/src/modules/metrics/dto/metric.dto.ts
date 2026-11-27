import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  GOOD_DIRECTIONS,
  type GoodDirection,
  METRIC_AGGREGATIONS,
  METRIC_SOURCE_KINDS,
  METRIC_UNITS,
  type MetricAggregation,
  type MetricSourceKind,
  type MetricUnit,
} from '../metrics.constants.js';
import type { MetricRow, Point } from '../repositories/metrics.repository.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class MetricSourceDto {
  @ApiProperty({ enum: METRIC_SOURCE_KINDS })
  @IsIn(METRIC_SOURCE_KINDS)
  kind: MetricSourceKind;

  @ApiPropertyOptional({
    description:
      'postgres.sql: read-only query with $1 (from day) and $2 (to day) returning columns day and value',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  query?: string;

  @ApiPropertyOptional({
    description: "http_api.series: path on the connection's URL; answers [{day, value}]",
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9/_.\-~%]*$/)
  path?: string;
}

export class MetricSourceResponseDto {
  @ApiProperty({ enum: METRIC_SOURCE_KINDS })
  kind: MetricSourceKind;

  @ApiProperty({ nullable: true, type: String })
  query: string | null;

  @ApiProperty({ nullable: true, type: String })
  path: string | null;
}

export class CreateMetricDto {
  @ApiProperty({ example: 'Выручка', maxLength: 60 })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  @Transform(trim)
  title: string;

  @ApiPropertyOptional({
    description: 'Stable key; generated from the source when omitted',
    example: 'active_users',
  })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]{1,40}$/)
  key?: string;

  @ApiPropertyOptional({ enum: METRIC_UNITS })
  @IsOptional()
  @IsIn(METRIC_UNITS)
  unit?: MetricUnit;

  @ApiPropertyOptional({ enum: METRIC_AGGREGATIONS })
  @IsOptional()
  @IsIn(METRIC_AGGREGATIONS)
  aggregation?: MetricAggregation;

  @ApiPropertyOptional({ enum: GOOD_DIRECTIONS })
  @IsOptional()
  @IsIn(GOOD_DIRECTIONS)
  goodDirection?: GoodDirection;

  @ApiPropertyOptional({ type: MetricSourceDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => MetricSourceDto)
  source?: MetricSourceDto | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  connectionId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

export class UpdateMetricDto {
  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  @Transform(trim)
  title?: string;

  @ApiPropertyOptional({ enum: METRIC_UNITS })
  @IsOptional()
  @IsIn(METRIC_UNITS)
  unit?: MetricUnit;

  @ApiPropertyOptional({ enum: METRIC_AGGREGATIONS })
  @IsOptional()
  @IsIn(METRIC_AGGREGATIONS)
  aggregation?: MetricAggregation;

  @ApiPropertyOptional({ enum: GOOD_DIRECTIONS })
  @IsOptional()
  @IsIn(GOOD_DIRECTIONS)
  goodDirection?: GoodDirection;

  @ApiPropertyOptional({ type: MetricSourceDto, nullable: true, description: 'null removes it' })
  @IsOptional()
  @ValidateNested()
  @Type(() => MetricSourceDto)
  source?: MetricSourceDto | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  connectionId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  position?: number;
}

export class MetricResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'revenue' })
  key: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: METRIC_UNITS })
  unit: MetricUnit;

  @ApiProperty({ enum: METRIC_AGGREGATIONS })
  aggregation: MetricAggregation;

  @ApiProperty({ enum: GOOD_DIRECTIONS })
  goodDirection: GoodDirection;

  @ApiProperty({ nullable: true, type: MetricSourceResponseDto })
  source: MetricSourceResponseDto | null;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  connectionId: string | null;

  @ApiProperty()
  pinned: boolean;

  @ApiProperty()
  position: number;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  collectedAt: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'UNAUTHORIZED' })
  lastError: string | null;

  static from(row: MetricRow): MetricResponseDto {
    return {
      id: row.id,
      key: row.key,
      title: row.title,
      unit: row.unit,
      aggregation: row.aggregation,
      goodDirection: row.good_direction,
      source: row.source
        ? { kind: row.source.kind, query: row.source.query ?? null, path: row.source.path ?? null }
        : null,
      connectionId: row.connection_id,
      pinned: row.pinned,
      position: row.position,
      collectedAt: row.collected_at?.toISOString() ?? null,
      lastError: row.last_error,
    };
  }
}

export class PointDto {
  @ApiProperty({ example: '2026-10-21' })
  day: string;

  @ApiProperty()
  value: number;

  static list(points: Point[]): PointDto[] {
    return points.map((point) => ({ day: point.day, value: point.value }));
  }
}

export class SeriesQueryDto {
  @ApiPropertyOptional({ enum: [7, 30, 90], default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 30, 90])
  days?: 7 | 30 | 90;
}

export class ResultsQueryDto {
  @ApiPropertyOptional({ enum: [30, 90], default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsIn([30, 90])
  days?: 30 | 90;

  @ApiPropertyOptional({ description: 'Metric key; the main metric by default' })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]{1,40}$/)
  metric?: string;
}
