import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export class EmailDto {
  @ApiProperty({ example: 'owner@example.com', maxLength: 254 })
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class RegisterDto extends EmailDto {
  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;

  @ApiPropertyOptional({ example: 'Виктор', maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  displayName?: string;
}

export class LoginDto extends EmailDto {
  @ApiProperty({ maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}

export class EmailCodeDto extends EmailDto {
  @ApiProperty({ example: '042517', description: 'Six-digit code from the email' })
  @Matches(/^\d{6}$/)
  code: string;
}

export class CodeDto {
  @ApiProperty({ example: '042517' })
  @Matches(/^\d{6}$/)
  code: string;
}

export class ResetPasswordDto extends EmailCodeDto {
  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;
}

export class ChangePasswordDto {
  @ApiPropertyOptional({ description: 'Required when the user already has a password' })
  @IsOptional()
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword?: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;
}

export class IdTokenDto {
  @ApiProperty({ description: 'OpenID Connect ID token obtained by the client from the provider' })
  @IsString()
  @MaxLength(8192)
  idToken: string;

  @ApiPropertyOptional({ description: 'Nonce sent to the provider (raw or SHA-256)' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  nonce?: string;

  @ApiPropertyOptional({ description: 'Apple passes the name to the client on first sign-in only' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  displayName?: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  refreshToken: string;
}

export class TokenPairResponseDto {
  @ApiProperty({ description: 'JWT for the Authorization: Bearer header' })
  accessToken: string;

  @ApiProperty()
  accessTokenExpiresAt: Date;

  @ApiProperty({ description: 'Opaque, single-use: every refresh returns a new one' })
  refreshToken: string;

  @ApiProperty()
  refreshTokenExpiresAt: Date;
}

export class AuthResponseDto extends TokenPairResponseDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ description: 'True when the call created a new user' })
  created: boolean;
}

export class RevokedSessionsResponseDto {
  @ApiProperty()
  revoked: number;
}
