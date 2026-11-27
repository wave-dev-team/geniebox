import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, ValidateIf } from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { type Locale, SUPPORTED_LOCALES } from '../../../common/i18n/locales.js';
import { IsTimeZone } from '../../../common/validation/is-time-zone.js';
import type { Profile } from '../users.service.js';

export class ProfileResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  emailVerified: boolean;

  @ApiProperty({ nullable: true, type: String })
  displayName: string | null;

  @ApiProperty({ enum: SUPPORTED_LOCALES })
  locale: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Europe/Moscow',
    description: "IANA time zone; null means the project's time zone",
  })
  timezone: string | null;

  @ApiProperty({ description: 'Whether email + password sign-in is set up' })
  hasPassword: boolean;

  @ApiProperty({ nullable: true, type: Date })
  passwordChangedAt: Date | null;

  @ApiProperty({ enum: ['google', 'apple'], isArray: true })
  identityProviders: string[];

  @ApiProperty()
  createdAt: Date;

  static from(profile: Profile): ProfileResponseDto {
    return {
      id: profile.id,
      email: profile.email,
      emailVerified: profile.email_verified_at !== null,
      displayName: profile.display_name,
      locale: profile.locale,
      timezone: profile.timezone,
      hasPassword: profile.hasPassword,
      passwordChangedAt: profile.password_changed_at,
      identityProviders: profile.identityProviders,
      createdAt: profile.created_at,
    };
  }
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ nullable: true, maxLength: 100, description: 'null clears the name' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 100)
  displayName?: string | null;

  @ApiPropertyOptional({ enum: SUPPORTED_LOCALES })
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES)
  locale?: Locale;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Europe/Moscow',
    description: "IANA time zone; null resets to the project's time zone",
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @IsTimeZone()
  timezone?: string | null;
}
