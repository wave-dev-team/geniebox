import type { Request } from 'express';

import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator.js';
import { StrictThrottle } from '../../common/throttler/strict-throttle.decorator.js';
import type { IdentityProvider } from '../users/repositories/users.repository.js';
import { AuthService } from './auth.service.js';
import {
  AuthResponseDto,
  ChangePasswordDto,
  CodeDto,
  EmailCodeDto,
  EmailDto,
  IdTokenDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  RevokedSessionsResponseDto,
  TokenPairResponseDto,
} from './dto/auth.dto.js';
import type { SessionMeta } from './sessions/session.store.js';

function sessionMeta(request: Request): SessionMeta {
  return { userAgent: request.headers['user-agent'], ip: request.ip };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @StrictThrottle()
  @Post('register')
  @ApiOperation({ summary: 'Sign up with email and password; sends an email verification code' })
  register(@Body() dto: RegisterDto, @Req() request: Request): Promise<AuthResponseDto> {
    return this.auth.register(dto, sessionMeta(request));
  }

  @Public()
  @StrictThrottle()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  login(@Body() dto: LoginDto, @Req() request: Request): Promise<AuthResponseDto> {
    return this.auth.login(dto, sessionMeta(request));
  }

  @Public()
  @StrictThrottle()
  @Post('email-code')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Send a sign-in code; signs up on first use. Same response for any email',
  })
  async requestLoginCode(@Body() dto: EmailDto): Promise<void> {
    await this.auth.requestLoginCode(dto.email);
  }

  @Public()
  @StrictThrottle()
  @Post('email-code/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in (or sign up) with the emailed code' })
  loginWithCode(@Body() dto: EmailCodeDto, @Req() request: Request): Promise<AuthResponseDto> {
    return this.auth.loginWithCode(dto, sessionMeta(request));
  }

  @Public()
  @StrictThrottle()
  @Post('oauth/google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with a Google ID token' })
  google(@Body() dto: IdTokenDto, @Req() request: Request): Promise<AuthResponseDto> {
    return this.oauth('google', dto, request);
  }

  @Public()
  @StrictThrottle()
  @Post('oauth/apple')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with an Apple ID token' })
  apple(@Body() dto: IdTokenDto, @Req() request: Request): Promise<AuthResponseDto> {
    return this.oauth('apple', dto, request);
  }

  @Public()
  @StrictThrottle()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Email a password reset code if the user exists' })
  async forgotPassword(@Body() dto: EmailDto): Promise<void> {
    await this.auth.requestPasswordReset(dto.email);
  }

  @Public()
  @StrictThrottle()
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set a new password with the emailed code; signs out all sessions' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.auth.resetPassword(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the refresh token; reuse of an old token revokes the session' })
  refresh(@Body() dto: RefreshDto): Promise<TokenPairResponseDto> {
    return this.auth.refresh(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(): Promise<void> {
    await this.auth.logout();
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke every session of the current user' })
  async logoutAll(): Promise<RevokedSessionsResponseDto> {
    return { revoked: await this.auth.logoutEverywhere() };
  }

  @ApiBearerAuth()
  @StrictThrottle()
  @Post('email/verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send an email verification code to the current user' })
  async requestVerification(): Promise<void> {
    await this.auth.requestEmailVerification();
  }

  @ApiBearerAuth()
  @StrictThrottle()
  @Post('email/verification/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Confirm the current user's email with the code" })
  async confirmVerification(@Body() dto: CodeDto): Promise<void> {
    await this.auth.confirmEmailVerification(dto.code);
  }

  @ApiBearerAuth()
  @StrictThrottle()
  @Post('password/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set or change the password; other sessions are signed out' })
  async changePassword(@Body() dto: ChangePasswordDto): Promise<void> {
    await this.auth.changePassword(dto);
  }

  private oauth(provider: IdentityProvider, dto: IdTokenDto, request: Request): Promise<AuthResponseDto> {
    return this.auth.loginWithProvider(provider, dto, sessionMeta(request));
  }
}
