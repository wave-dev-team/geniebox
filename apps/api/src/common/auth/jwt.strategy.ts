import { ExtractJwt, Strategy } from 'passport-jwt';
import { z } from 'zod';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ClsService } from 'nestjs-cls';

import type { RequestContext } from '../../database/tenant-db.js';

const claimsSchema = z.object({
  sub: z.string().min(1),
  tenant_id: z.uuid(),
  exp: z.number().int().positive(),
});

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly context: ClsService<RequestContext>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
      issuer: 'geniebox',
      audience: 'geniebox-api',
    });
  }

  validate(payload: unknown) {
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) {
      throw new UnauthorizedException();
    }

    this.context.set('tenantId', claims.data.tenant_id);
    return { id: claims.data.sub, tenantId: claims.data.tenant_id };
  }
}
