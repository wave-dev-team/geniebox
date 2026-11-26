import type { Request } from 'express';

import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';

import { AuthError } from '../../modules/auth/auth-errors.js';

@Injectable()
export class SameOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    const site = request.get('Sec-Fetch-Site');
    if (request.get('X-Geniebox-Request') !== '1' || (site && site !== 'same-origin')) {
      throw new AuthError('CROSS_ORIGIN_REQUEST');
    }
    return true;
  }
}
