import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { UnauthorizedException } from '../exceptions/index.js';

/**
 * Global guard: every endpoint is closed unless marked @Public().
 * Replaced by the JWT / service-token guard once authentication lands; until then
 * nothing non-public is reachable by construction.
 */
@Injectable()
export class DefaultDenyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    throw new UnauthorizedException();
  }
}
