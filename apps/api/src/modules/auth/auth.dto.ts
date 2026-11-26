import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { locales, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@workspace/types';

export class EmailDto {
  @ApiProperty({ format: 'email', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class LoginDto extends EmailDto {
  @ApiProperty({ format: 'password', maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password!: string;
}

export class RegisterDto extends EmailDto {
  @ApiProperty({ format: 'password', minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  password!: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  @Matches(/\S/)
  name!: string;

  @ApiPropertyOptional({ enum: locales })
  @IsOptional()
  @IsIn(locales)
  locale?: string;
}

export class CodeDto {
  @ApiProperty({ pattern: '^\\d{6}$' })
  @Matches(/^\d{6}$/)
  code!: string;
}

export class EmailCodeDto extends CodeDto {
  @ApiProperty({ format: 'email', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetDto extends EmailCodeDto {
  @ApiProperty({ format: 'password', minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  newPassword!: string;
}

export class ChangePasswordDto {
  @ApiPropertyOptional({ format: 'password', maxLength: PASSWORD_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  currentPassword?: string;

  @ApiProperty({ format: 'password', minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  newPassword!: string;
}

export class AuthResultDto {
  @ApiProperty()
  created!: boolean;

  @ApiProperty()
  emailVerified!: boolean;
}

export class SessionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  current!: boolean;

  @ApiProperty({ nullable: true, type: String })
  userAgent!: string | null;

  @ApiProperty({ nullable: true, type: String })
  ip!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  lastActiveAt!: string;
}
