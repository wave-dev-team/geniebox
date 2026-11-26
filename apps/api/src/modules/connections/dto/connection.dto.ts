import { Transform } from 'class-transformer';
import { IsIn, IsObject, IsOptional, IsString, Length, Matches } from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { CheckOutcome } from '../connection-check.types.js';
import {
  ACCESS_LEVELS,
  type AccessLevel,
  CONNECTION_CATEGORIES,
  type ConnectionCategory,
  FIELD_KINDS,
  type FieldKind,
  type ProviderDefinition,
} from '../providers/provider.types.js';
import { findProvider } from '../providers/registry.js';
import type { ConnectionRow, CredentialMeta } from '../repositories/connections.repository.js';

const CATEGORY_KEYS = Object.keys(CONNECTION_CATEGORIES) as ConnectionCategory[];
const STATUSES = ['pending', 'ok', 'warn', 'error'] as const;
const PROVIDER_KEY = /^[a-z][a-z0-9_]{1,40}$/;
const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/** Days before expiry when a credential shows as «Истекает». */
export const EXPIRING_DAYS = 7;

export class ProviderFieldDto {
  @ApiProperty()
  key: string;

  @ApiProperty({ enum: FIELD_KINDS })
  kind: FieldKind;

  @ApiProperty()
  required: boolean;

  @ApiProperty({ isArray: true, type: String, nullable: true })
  options: string[] | null;

  @ApiProperty({ nullable: true, type: String })
  defaultValue: string | null;
}

export class ProviderResponseDto {
  @ApiProperty({ example: 'telegram_bot' })
  key: string;

  @ApiProperty({ enum: CATEGORY_KEYS })
  category: ConnectionCategory;

  @ApiProperty({ description: 'Share of «the team sees N%» this category adds' })
  weight: number;

  @ApiProperty({ enum: ACCESS_LEVELS, isArray: true })
  accessLevels: AccessLevel[];

  @ApiProperty({ description: 'The platform generates an SSH key; no secret is entered' })
  sshKey: boolean;

  @ApiProperty({ type: [ProviderFieldDto] })
  fields: ProviderFieldDto[];

  static from(provider: ProviderDefinition): ProviderResponseDto {
    return {
      key: provider.key,
      category: provider.category,
      weight: CONNECTION_CATEGORIES[provider.category],
      accessLevels: [...provider.accessLevels],
      sshKey: provider.sshKey ?? false,
      fields: provider.fields.map((field) => ({
        key: field.key,
        kind: field.kind,
        required: field.required,
        options: field.options ? [...field.options] : null,
        defaultValue: field.defaultValue ?? null,
      })),
    };
  }
}

export class CreateConnectionDto {
  @ApiProperty({ example: 'telegram_bot' })
  @Matches(PROVIDER_KEY)
  providerKey: string;

  @ApiPropertyOptional({ maxLength: 120, description: 'Defaults to the provider name in the UI' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ enum: ACCESS_LEVELS, default: 'read' })
  @IsOptional()
  @IsIn(ACCESS_LEVELS)
  accessLevel?: AccessLevel;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Provider fields, secret ones included; validated against the provider',
  })
  @IsObject()
  fields: Record<string, string>;
}

export class UpdateConnectionDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ enum: ACCESS_LEVELS })
  @IsOptional()
  @IsIn(ACCESS_LEVELS)
  accessLevel?: AccessLevel;
}

export class RotateCredentialDto {
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'New secret fields; omit for SSH (a new key pair is generated)',
  })
  @IsOptional()
  @IsObject()
  fields?: Record<string, string>;
}

export class CreateConnectionLinkDto {
  @ApiProperty({ example: 'yookassa' })
  @Matches(PROVIDER_KEY)
  providerKey: string;
}

export class SubmitConnectionLinkDto {
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  @IsObject()
  fields: Record<string, string>;
}

export class CheckOutcomeDto {
  @ApiProperty({ enum: ['ok', 'warn', 'error'] })
  status: 'ok' | 'warn' | 'error';

  @ApiProperty({ nullable: true, type: String })
  reason: string | null;

  @ApiProperty({ nullable: true, type: String })
  detail: string | null;

  static from(outcome: CheckOutcome): CheckOutcomeDto {
    return { ...outcome };
  }
}

export class CredentialSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  version: number;

  @ApiProperty({ example: '••••a91f' })
  masked: string;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ nullable: true, type: Date })
  expiresAt: Date | null;

  @ApiProperty({ enum: ['ok', 'expiring', 'expired'] })
  health: 'ok' | 'expiring' | 'expired';

  static from(meta: CredentialMeta): CredentialSummaryDto {
    const expires = meta.expires_at?.getTime();
    const now = Date.now();
    return {
      id: meta.id,
      version: meta.version,
      masked: meta.masked,
      updatedAt: meta.created_at,
      expiresAt: meta.expires_at,
      health:
        expires === undefined
          ? 'ok'
          : expires <= now
            ? 'expired'
            : expires - now < EXPIRING_DAYS * 86_400_000
              ? 'expiring'
              : 'ok',
    };
  }
}

export class ConnectionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  providerKey: string;

  @ApiProperty({ enum: CATEGORY_KEYS })
  category: ConnectionCategory;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: ACCESS_LEVELS })
  accessLevel: AccessLevel;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Non-secret settings (URL, ids, SSH public key)',
  })
  config: Record<string, string>;

  @ApiProperty({ enum: STATUSES })
  status: (typeof STATUSES)[number];

  @ApiProperty({ nullable: true, type: String, description: 'Machine code of the last check' })
  statusReason: string | null;

  @ApiProperty({ nullable: true, type: String })
  statusDetail: string | null;

  @ApiProperty({ nullable: true, type: Date })
  lastCheckAt: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  lastSyncAt: Date | null;

  @ApiProperty({ enum: ['user', 'dev_link'] })
  createdVia: 'user' | 'dev_link';

  @ApiProperty({ nullable: true, type: CredentialSummaryDto })
  credential: CredentialSummaryDto | null;

  @ApiProperty()
  createdAt: Date;

  static from(row: ConnectionRow, credential?: CredentialMeta): ConnectionResponseDto {
    const provider = findProvider(row.provider_key);
    return {
      id: row.id,
      providerKey: row.provider_key,
      category: provider?.category ?? 'database',
      name: row.name,
      accessLevel: row.access_level as AccessLevel,
      config: row.config,
      status: row.status as ConnectionResponseDto['status'],
      statusReason: row.status_reason,
      statusDetail: row.status_detail,
      lastCheckAt: row.last_check_at,
      lastSyncAt: row.last_sync_at,
      createdVia: row.created_via as ConnectionResponseDto['createdVia'],
      credential: credential ? CredentialSummaryDto.from(credential) : null,
      createdAt: row.created_at,
    };
  }
}

export class ConnectionWithCheckDto {
  @ApiProperty({ type: ConnectionResponseDto })
  connection: ConnectionResponseDto;

  @ApiProperty({
    nullable: true,
    type: CheckOutcomeDto,
    description: 'Null when the check did not finish in time; the status updates later',
  })
  check: CheckOutcomeDto | null;
}

export class ConnectionsSummaryDto {
  @ApiProperty({ description: 'Team sees N% of the project' })
  coveragePct: number;

  @ApiProperty()
  working: number;

  @ApiProperty({ description: 'Connections with warn or error status' })
  attention: number;

  @ApiProperty({ enum: CATEGORY_KEYS, isArray: true, description: 'Categories not connected yet' })
  missingCategories: ConnectionCategory[];
}

export class DisconnectAllResponseDto {
  @ApiProperty()
  disconnected: number;
}

export class SubmitConnectionLinkResponseDto {
  @ApiProperty({ nullable: true, type: CheckOutcomeDto })
  check: CheckOutcomeDto | null;
}

export class ConnectionLinkResponseDto {
  @ApiProperty({ description: 'Opens without signing in; shown once' })
  url: string;

  @ApiProperty()
  expiresAt: Date;
}

export class PublicConnectionLinkDto {
  @ApiProperty()
  projectName: string;

  @ApiProperty({ type: ProviderResponseDto })
  provider: ProviderResponseDto;

  @ApiProperty()
  expiresAt: Date;
}

export function providerOrNull(key: string): ProviderDefinition | null {
  return findProvider(key) ?? null;
}
