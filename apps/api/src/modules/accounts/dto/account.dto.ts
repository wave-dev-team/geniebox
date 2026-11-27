import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  ACCOUNT_ROLES,
  type AccountRole,
  ASSIGNABLE_ROLES,
  type AssignableRole,
} from '../../../common/auth/account-role.js';
import { type Locale, SUPPORTED_LOCALES } from '../../../common/i18n/locales.js';
import type { AccountWithRole } from '../repositories/accounts.repository.js';
import type { InvitationRow } from '../repositories/invitations.repository.js';
import type { MemberView } from '../repositories/members.repository.js';
import { SLUG_PATTERN } from '../slug.js';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

export class CreateAccountDto {
  @ApiProperty({ example: 'SafeConnect VPN', maxLength: 200 })
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name: string;

  @ApiPropertyOptional({
    example: 'safeconnect',
    description: 'Generated from the name if omitted',
  })
  @IsOptional()
  @Matches(SLUG_PATTERN)
  slug?: string;

  @ApiPropertyOptional({ enum: SUPPORTED_LOCALES, default: 'ru' })
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES)
  locale?: Locale;
}

export class UpdateAccountDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional({ enum: SUPPORTED_LOCALES })
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES)
  locale?: Locale;
}

export class AccountResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: SUPPORTED_LOCALES })
  locale: string;

  @ApiProperty({ enum: ACCOUNT_ROLES, description: 'Role of the current user' })
  role: AccountRole;

  @ApiProperty({ description: 'Kill switch: agents may perform mutating actions only when true' })
  agentActionsEnabled: boolean;

  @ApiProperty()
  createdAt: Date;

  static from(account: AccountWithRole): AccountResponseDto {
    return {
      id: account.id,
      slug: account.slug,
      name: account.name,
      locale: account.locale,
      role: account.role,
      agentActionsEnabled: account.agent_actions_enabled,
      createdAt: account.created_at,
    };
  }
}

export class MemberResponseDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ nullable: true, type: String })
  displayName: string | null;

  @ApiProperty({ enum: ACCOUNT_ROLES })
  role: AccountRole;

  @ApiProperty()
  joinedAt: Date;

  static from(member: MemberView): MemberResponseDto {
    return { ...member };
  }
}

export class ChangeRoleDto {
  @ApiProperty({ enum: ASSIGNABLE_ROLES, description: 'Owner changes only via ownership transfer' })
  @IsIn(ASSIGNABLE_ROLES)
  role: AssignableRole;
}

export class TransferOwnershipDto {
  @ApiProperty({ format: 'uuid' })
  @Matches(/^[0-9a-f-]{36}$/i)
  userId: string;
}

export class CreateInvitationDto {
  @ApiProperty({ example: 'colleague@example.com' })
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ enum: ASSIGNABLE_ROLES, default: 'tech' })
  @IsIn(ASSIGNABLE_ROLES)
  role: AssignableRole;
}

export class InvitationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: ASSIGNABLE_ROLES })
  role: AssignableRole;

  @ApiProperty({ format: 'uuid' })
  invitedBy: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty()
  expired: boolean;

  static from(row: InvitationRow): InvitationResponseDto {
    return {
      id: row.id,
      email: row.email,
      role: row.role as AssignableRole,
      invitedBy: row.invited_by,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      expired: row.expires_at.getTime() < Date.now(),
    };
  }
}

export class AcceptInvitationDto {
  @ApiProperty({ description: 'Token from the invitation link' })
  @IsString()
  @Length(20, 100)
  token: string;
}
