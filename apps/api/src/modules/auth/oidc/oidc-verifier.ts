import { createHash } from 'node:crypto';

import { createRemoteJWKSet, type JWTPayload, jwtVerify, type JWTVerifyGetKey } from 'jose';

import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../../config/env.schema.js';
import type { IdentityProvider } from '../../users/repositories/users.repository.js';

interface ProviderSpec {
  issuers: string[];
  jwksUri: string;
}

const PROVIDERS: Record<IdentityProvider, ProviderSpec> = {
  google: {
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
  },
  apple: {
    issuers: ['https://appleid.apple.com'],
    jwksUri: 'https://appleid.apple.com/auth/keys',
  },
};

export interface VerifiedIdentity {
  provider: IdentityProvider;
  subject: string;
  email: string | undefined;
  emailVerified: boolean;
  name: string | undefined;
}

export type OidcVerificationResult =
  { status: 'verified'; identity: VerifiedIdentity } | { status: 'disabled' } | { status: 'invalid' };

/** Key resolver per provider; overridable in tests with a local JWKS. */
export const OIDC_KEY_RESOLVERS = Symbol('OIDC_KEY_RESOLVERS');
export type OidcKeyResolvers = Partial<Record<IdentityProvider, JWTVerifyGetKey>>;

/**
 * Verifies ID tokens obtained by the client (Google Sign-In, Sign in with Apple): signature
 * via provider JWKS, issuer, audience = one of our client ids, expiry, optional nonce.
 */
@Injectable()
export class OidcVerifier {
  private readonly audiences: Record<IdentityProvider, string[]>;
  private readonly resolvers: Record<IdentityProvider, JWTVerifyGetKey>;

  constructor(
    config: ConfigService<Env, true>,
    @Optional() @Inject(OIDC_KEY_RESOLVERS) overrides: OidcKeyResolvers | null = null,
  ) {
    this.audiences = {
      google: config.get('AUTH_GOOGLE_CLIENT_IDS', { infer: true }),
      apple: config.get('AUTH_APPLE_CLIENT_IDS', { infer: true }),
    };
    // createRemoteJWKSet caches keys and refetches on unknown `kid` (provider key rotation).
    this.resolvers = {
      google: overrides?.google ?? createRemoteJWKSet(new URL(PROVIDERS.google.jwksUri)),
      apple: overrides?.apple ?? createRemoteJWKSet(new URL(PROVIDERS.apple.jwksUri)),
    };
  }

  isEnabled(provider: IdentityProvider): boolean {
    return this.audiences[provider].length > 0;
  }

  async verify(provider: IdentityProvider, idToken: string, nonce?: string): Promise<OidcVerificationResult> {
    if (!this.isEnabled(provider)) {
      return { status: 'disabled' };
    }
    let payload: JWTPayload;
    try {
      const result = await jwtVerify(idToken, this.resolvers[provider], {
        issuer: PROVIDERS[provider].issuers,
        audience: this.audiences[provider],
        algorithms: ['RS256', 'ES256'],
        clockTolerance: 30,
      });
      payload = result.payload;
    } catch {
      return { status: 'invalid' };
    }
    if (!payload.sub || (nonce !== undefined && !nonceMatches(payload.nonce, nonce))) {
      return { status: 'invalid' };
    }
    return {
      status: 'verified',
      identity: {
        provider,
        subject: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        // Apple sends "true"/"false" strings, Google booleans.
        emailVerified: payload.email_verified === true || payload.email_verified === 'true',
        name: typeof payload.name === 'string' ? payload.name : undefined,
      },
    };
  }
}

// Clients may send either the raw nonce or pass its SHA-256 to the provider (Apple guidance).
function nonceMatches(claim: unknown, nonce: string): boolean {
  if (typeof claim !== 'string') return false;
  return claim === nonce || claim === createHash('sha256').update(nonce).digest('hex');
}
