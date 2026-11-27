import type { Request } from 'express';

import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../../common/context/app-cls-store.js';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator.js';
import { UnauthorizedException } from '../../../common/exceptions/index.js';
import { SessionStore } from '../sessions/session.store.js';
import { AccessTokenService } from '../tokens/access-token.service.js';

/**
 * Global guard of the public API: every route needs a valid access token of a live session
 * unless marked @Public(). Puts userId/sessionId into CLS for services and RLS.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    private readonly sessions: SessionStore,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets)) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(request);
    const claims = token ? await this.tokens.verify(token) : undefined;
    // Session check makes logout, password reset and blocking effective before token expiry.
    if (!claims || !(await this.sessions.isActive(claims.sid))) {
      throw new UnauthorizedException();
    }
    this.cls.set('userId', claims.sub);
    this.cls.set('sessionId', claims.sid);
    return true;
  }
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : undefined;
}
