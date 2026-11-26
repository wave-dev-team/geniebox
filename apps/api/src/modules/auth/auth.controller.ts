import type { Request, Response } from 'express';

import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { clearAuthCookies, readRefreshCookie, setAuthCookies } from '../../common/auth/auth-cookie.js';
import { Public } from '../../common/auth/public.js';
import {
  AuthResultDto,
  ChangePasswordDto,
  CodeDto,
  EmailCodeDto,
  EmailDto,
  LoginDto,
  RegisterDto,
  ResetDto,
} from './auth.dto.js';
import { AuthService } from './auth.service.js';
import { AuthError } from './auth-errors.js';
import { type Actor, SessionStore } from './session.store.js';

export type AuthenticatedRequest = Request & { user: Actor };

const tightRate = { default: { limit: 15, ttl: 60_000 } };
const meta = (req: Request) => ({ userAgent: req.get('User-Agent'), ip: req.ip });

@ApiTags('auth')
@ApiHeader({ name: 'X-Geniebox-Request', required: true, schema: { default: '1' } })
@Controller('auth')
export class AuthController {
  private readonly secure: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionStore,
    config: ConfigService,
  ) {
    this.secure = config.get('AUTH_COOKIE_SECURE') !== 'false' && config.get('NODE_ENV') === 'production';
  }

  @Public()
  @Throttle(tightRate)
  @Post('register')
  @ApiOkResponse({ type: AuthResultDto })
  @HttpCode(200)
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.register(dto, meta(request));
    setAuthCookies(response, this.secure, session);
    return session.result;
  }

  @Public()
  @Throttle(tightRate)
  @Post('login')
  @ApiOkResponse({ type: AuthResultDto })
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.login(dto.email, dto.password, meta(request));
    setAuthCookies(response, this.secure, session);
    return session.result;
  }

  @Public()
  @Throttle(tightRate)
  @Post('email-code')
  @HttpCode(204)
  requestLoginCode(@Body() dto: EmailDto) {
    return this.auth.requestCode('login', dto.email);
  }

  @Public()
  @Throttle(tightRate)
  @Post('email-code/verify')
  @ApiOkResponse({ type: AuthResultDto })
  @HttpCode(200)
  async verifyLoginCode(
    @Body() dto: EmailCodeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.loginWithCode(dto.email, dto.code, meta(request));
    setAuthCookies(response, this.secure, session);
    return session.result;
  }

  @Public()
  @Throttle(tightRate)
  @Post('password/forgot')
  @HttpCode(204)
  forgotPassword(@Body() dto: EmailDto) {
    return this.auth.requestCode('reset', dto.email);
  }

  @Public()
  @Throttle(tightRate)
  @Post('password/reset')
  @HttpCode(204)
  resetPassword(@Body() dto: ResetDto) {
    return this.auth.resetPassword(dto.email, dto.code, dto.newPassword);
  }

  @Public()
  @Post('refresh')
  @HttpCode(204)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    try {
      setAuthCookies(response, this.secure, await this.auth.refresh(readRefreshCookie(request)));
    } catch (error) {
      if (error instanceof AuthError && error.code === 'SESSION_EXPIRED')
        clearAuthCookies(response, this.secure);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    await this.sessions.revoke(request.user);
    clearAuthCookies(response, this.secure);
  }

  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    await this.sessions.revokeAll(request.user);
    clearAuthCookies(response, this.secure);
  }

  @Post('email/verification')
  @Throttle(tightRate)
  @HttpCode(204)
  requestVerification(@Req() request: AuthenticatedRequest) {
    return this.auth.requestVerification(request.user);
  }

  @Post('email/verification/confirm')
  @Throttle(tightRate)
  @HttpCode(204)
  verifyEmail(@Body() dto: CodeDto, @Req() request: AuthenticatedRequest) {
    return this.auth.verifyEmail(request.user, dto.code);
  }

  @Post('password/change')
  @Throttle(tightRate)
  @HttpCode(204)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const replacement = await this.auth.changePassword(
      request.user,
      dto.currentPassword,
      dto.newPassword,
      meta(request),
    );
    setAuthCookies(response, this.secure, replacement);
  }
}
