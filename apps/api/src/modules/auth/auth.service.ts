import { Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { I18nContext } from 'nestjs-i18n';

import type { AppClsStore } from '../../common/context/app-cls-store.js';
import { UserContextMissingException } from '../../common/exceptions/index.js';
import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES } from '../../common/i18n/locales.js';
import { MailService } from '../mail/mail.service.js';
import { normalizeEmail } from '../users/email.js';
import type { IdentityProvider, UserRow } from '../users/repositories/users.repository.js';
import { UsersService } from '../users/users.service.js';
import { AUTH_ERRORS, AuthException } from './auth.errors.js';
import { EMAIL_CODE_TTL_MINUTES, type EmailCodePurpose, EmailCodeStore } from './codes/email-code.store.js';
import { LoginAttemptsLimiter } from './login-attempts.limiter.js';
import { OidcVerifier } from './oidc/oidc-verifier.js';
import { PasswordHasher } from './passwords/password-hasher.js';
import { type SessionMeta, SessionStore } from './sessions/session.store.js';
import { AccessTokenService } from './tokens/access-token.service.js';

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface AuthResult extends TokenPair {
  userId: string;
  /** True when this call created the user (sign-up). */
  created: boolean;
}

const CODE_TEMPLATES = {
  login: 'login_code',
  verify_email: 'verify_email_code',
  reset_password: 'reset_password_code',
} as const satisfies Record<EmailCodePurpose, string>;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionStore,
    private readonly accessTokens: AccessTokenService,
    private readonly codes: EmailCodeStore,
    private readonly limiter: LoginAttemptsLimiter,
    private readonly oidc: OidcVerifier,
    private readonly mail: MailService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async register(
    input: { email: string; password: string; displayName?: string },
    meta: SessionMeta,
  ): Promise<AuthResult> {
    const user = await this.users.registerWithPassword({
      email: input.email,
      passwordHash: await this.hasher.hash(input.password),
      displayName: input.displayName,
      locale: requestLocale(),
    });
    await this.sendCode('verify_email', user.email, user.locale);
    return this.startSession(user, meta, true);
  }

  async login(input: { email: string; password: string }, meta: SessionMeta): Promise<AuthResult> {
    const email = normalizeEmail(input.email);
    if (await this.limiter.isLocked(email)) {
      throw new AuthException(AUTH_ERRORS.TOO_MANY_LOGIN_ATTEMPTS);
    }
    const user = await this.users.findByEmail(email);
    // Always runs argon2 (against a dummy hash for unknown emails) to keep timing uniform.
    const valid = await this.hasher.verify(user?.password_hash, input.password);
    if (!user || !valid) {
      await this.limiter.recordFailure(email);
      if (user) {
        await this.users.recordPlatformAction(user.id, 'auth.login.password', 'rejected');
      }
      throw new AuthException(AUTH_ERRORS.INVALID_CREDENTIALS);
    }
    await this.users.getActiveById(user.id);
    await this.limiter.reset(email);
    return this.startSession(user, meta, false);
  }

  /** Sign-in (or sign-up) code. Same response whether or not the email is registered. */
  async requestLoginCode(emailInput: string): Promise<void> {
    const email = normalizeEmail(emailInput);
    const user = await this.users.findByEmail(email);
    await this.sendCode('login', email, user?.locale ?? requestLocale(), { strictCooldown: true });
  }

  async loginWithCode(input: { email: string; code: string }, meta: SessionMeta): Promise<AuthResult> {
    const email = normalizeEmail(input.email);
    if (!(await this.codes.consume('login', email, input.code))) {
      throw new AuthException(AUTH_ERRORS.INVALID_CODE);
    }
    const { user, created } = await this.users.findOrCreateVerified(email, requestLocale());
    return this.startSession(user, meta, created);
  }

  async loginWithProvider(
    provider: IdentityProvider,
    input: { idToken: string; nonce?: string; displayName?: string },
    meta: SessionMeta,
  ): Promise<AuthResult> {
    const result = await this.oidc.verify(provider, input.idToken, input.nonce);
    if (result.status === 'disabled') {
      throw new AuthException(AUTH_ERRORS.OIDC_PROVIDER_DISABLED);
    }
    if (result.status === 'invalid') {
      throw new AuthException(AUTH_ERRORS.INVALID_ID_TOKEN);
    }
    const { identity } = result;
    if (!identity.email) {
      throw new AuthException(AUTH_ERRORS.OIDC_EMAIL_REQUIRED);
    }
    const existing = await this.users.findByEmail(identity.email);
    const user = await this.users.resolveExternalIdentity(
      {
        provider,
        subject: identity.subject,
        email: identity.email,
        emailVerified: identity.emailVerified,
        // Apple returns the name to the client only once; accept it from the request then.
        displayName: identity.name ?? input.displayName,
      },
      requestLocale(),
    );
    return this.startSession(user, meta, !existing);
  }

  /** Always succeeds from the caller's point of view: no account enumeration. */
  async requestPasswordReset(emailInput: string): Promise<void> {
    const user = await this.users.findByEmail(emailInput);
    if (user?.status === 'active') {
      await this.sendCode('reset_password', user.email, user.locale, { strictCooldown: false });
    }
  }

  async resetPassword(input: { email: string; code: string; newPassword: string }): Promise<void> {
    const email = normalizeEmail(input.email);
    if (!(await this.codes.consume('reset_password', email, input.code))) {
      throw new AuthException(AUTH_ERRORS.INVALID_CODE);
    }
    const user = await this.users.findByEmail(email);
    if (!user) {
      throw new AuthException(AUTH_ERRORS.INVALID_CODE);
    }
    await this.users.setPassword(user.id, await this.hasher.hash(input.newPassword));
    // The code proved control of the mailbox.
    await this.users.markEmailVerified(user.id);
    await this.sessions.revokeAll(user.id);
    await this.limiter.reset(email);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const rotation = await this.sessions.rotate(refreshToken);
    switch (rotation.status) {
      case 'rotated': {
        await this.users.touchLastSeen(rotation.userId);
        const access = await this.accessTokens.issue(rotation.userId, rotation.sessionId);
        return {
          accessToken: access.accessToken,
          accessTokenExpiresAt: access.expiresAt,
          refreshToken: rotation.refreshToken,
          refreshTokenExpiresAt: rotation.expiresAt,
        };
      }
      case 'concurrent':
        throw new AuthException(AUTH_ERRORS.REFRESH_IN_PROGRESS);
      case 'reused':
        this.logger.warn('Refresh token reuse detected, session revoked');
        throw new AuthException(AUTH_ERRORS.REFRESH_TOKEN_REUSED);
      case 'invalid':
        throw new AuthException(AUTH_ERRORS.INVALID_REFRESH_TOKEN);
    }
  }

  async logout(): Promise<void> {
    const sessionId = this.cls.get('sessionId');
    if (sessionId) {
      await this.sessions.revoke(sessionId);
    }
  }

  async logoutEverywhere(): Promise<number> {
    return this.sessions.revokeAll(this.currentUserId());
  }

  async requestEmailVerification(): Promise<void> {
    const user = await this.users.getActiveById(this.currentUserId());
    if (!user.email_verified_at) {
      await this.sendCode('verify_email', user.email, user.locale, { strictCooldown: true });
    }
  }

  async confirmEmailVerification(code: string): Promise<void> {
    const user = await this.users.getActiveById(this.currentUserId());
    if (!(await this.codes.consume('verify_email', user.email, code))) {
      throw new AuthException(AUTH_ERRORS.INVALID_CODE);
    }
    await this.users.markEmailVerified(user.id);
  }

  /** Sets or changes the password; other sessions are signed out. */
  async changePassword(input: { currentPassword?: string; newPassword: string }): Promise<void> {
    const user = await this.users.getActiveById(this.currentUserId());
    if (user.password_hash) {
      const valid = await this.hasher.verify(user.password_hash, input.currentPassword ?? '');
      if (!valid) {
        throw new AuthException(AUTH_ERRORS.CURRENT_PASSWORD_INVALID);
      }
    }
    await this.users.setPassword(user.id, await this.hasher.hash(input.newPassword));
    await this.sessions.revokeAll(user.id, this.cls.get('sessionId'));
  }

  private async startSession(user: UserRow, meta: SessionMeta, created: boolean): Promise<AuthResult> {
    // Blocked by an administrator: no sign-in by any method.
    if (user.status !== 'active') {
      await this.users.getActiveById(user.id);
    }
    await this.users.touchLastSeen(user.id);
    const refresh = await this.sessions.create(user.id, meta);
    const access = await this.accessTokens.issue(user.id, refresh.sessionId);
    await this.users.recordPlatformAction(user.id, 'auth.session.create', 'succeeded', {
      sessionId: refresh.sessionId,
    });
    return {
      userId: user.id,
      created,
      accessToken: access.accessToken,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: refresh.refreshToken,
      refreshTokenExpiresAt: refresh.expiresAt,
    };
  }

  private async sendCode(
    purpose: EmailCodePurpose,
    email: string,
    locale: string,
    options: { strictCooldown: boolean } = { strictCooldown: false },
  ): Promise<void> {
    const issued = await this.codes.issue(purpose, email);
    if (issued.status === 'cooldown') {
      if (options.strictCooldown) {
        throw new AuthException(AUTH_ERRORS.CODE_RESEND_TOO_SOON);
      }
      return;
    }
    await this.mail.send({
      to: email,
      template: CODE_TEMPLATES[purpose],
      locale: toLocale(locale),
      params: { code: issued.code, ttlMinutes: String(EMAIL_CODE_TTL_MINUTES) },
    });
  }

  private currentUserId(): string {
    const userId = this.cls.get('userId');
    if (!userId) {
      throw new UserContextMissingException();
    }
    return userId;
  }
}

function toLocale(value: string | undefined): Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value ?? '') ? (value as Locale) : DEFAULT_LOCALE;
}

function requestLocale(): Locale {
  return toLocale(I18nContext.current()?.lang);
}
