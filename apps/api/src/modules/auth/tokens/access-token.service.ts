import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { Env } from '../../../config/env.schema.js';

const ISSUER = 'geniebox';
const AUDIENCE = 'geniebox-api';

export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  /** Session id; the guard checks the session still exists, which makes logout immediate. */
  sid: string;
  typ: 'access';
}

export interface IssuedAccessToken {
  accessToken: string;
  expiresAt: Date;
}

@Injectable()
export class AccessTokenService {
  private readonly ttlSec: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlSec = config.get('ACCESS_TOKEN_TTL_SEC', { infer: true });
  }

  async issue(userId: string, sessionId: string): Promise<IssuedAccessToken> {
    const claims: AccessTokenClaims = { sub: userId, sid: sessionId, typ: 'access' };
    const accessToken = await this.jwt.signAsync(claims, {
      expiresIn: this.ttlSec,
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithm: 'HS256',
    });
    return { accessToken, expiresAt: new Date(Date.now() + this.ttlSec * 1000) };
  }

  /** Returns claims or undefined; never throws on a bad token. */
  async verify(token: string): Promise<AccessTokenClaims | undefined> {
    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      return claims.typ === 'access' && typeof claims.sid === 'string' ? claims : undefined;
    } catch {
      return undefined;
    }
  }
}
