import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { z } from 'zod';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ClsService } from 'nestjs-cls';

import type { RequestContext } from '../../database/tenant-db.js';
import { SessionStore } from '../../modules/auth/session.store.js';
import { ProfileRepository } from '../../modules/profile/profile.repository.js';
import { ACCESS_COOKIE, readCookie } from './auth-cookie.js';

const claimsSchema = z.object({
  sub: z.uuid(),
  tenant_id: z.uuid(),
  sid: z.uuid(),
  ver: z.iso.datetime(),
  exp: z.number().int().positive(),
});

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly context: ClsService<RequestContext>,
    private readonly sessions: SessionStore,
    private readonly profiles: ProfileRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => readCookie(request, ACCESS_COOKIE) ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
      issuer: 'geniebox',
      audience: 'geniebox-api',
    });
  }

  async validate(payload: unknown) {
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) throw new UnauthorizedException();
    const { sub: userId, tenant_id: tenantId, sid: sessionId, ver } = claims.data;
    const actor = { tenantId, userId, sessionId };
    if (!(await this.sessions.isActive(actor, ver))) throw new UnauthorizedException();
    const user = await this.profiles.find(actor);
    if (!user || user.password_changed_at.toISOString() !== ver) throw new UnauthorizedException();
    this.context.set('tenantId', tenantId);
    return actor;
  }
}
