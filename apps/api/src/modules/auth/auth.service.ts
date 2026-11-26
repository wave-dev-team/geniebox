import type { Selectable } from 'kysely';

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { I18nContext } from 'nestjs-i18n';

import { localeSchema } from '@workspace/types';

import type { UserProfiles } from '../../database/types.js';
import { type Identity, ProfileRepository } from '../profile/profile.repository.js';
import { AuthError } from './auth-errors.js';
import { EmailCodesService, type EmailPurpose } from './email-codes.service.js';
import { LoginAttempts } from './login-attempts.js';
import { PasswordHasher } from './password-hasher.js';
import { ACCESS_SECONDS, type Actor, SessionStore } from './session.store.js';

type UserRow = Selectable<UserProfiles>;
type Meta = { userAgent?: string; ip?: string };

const normalise = (email: string) => email.trim().toLowerCase();
const identity = (user: UserRow): Identity => ({ tenantId: user.tenant_id, userId: user.id });
const version = (user: UserRow) => user.password_changed_at.toISOString();
const requestLocale = () => localeSchema.safeParse(I18nContext.current()?.lang).data ?? 'ru';
const isDuplicate = (error: unknown) =>
  error instanceof Error && 'constraint' in error && error.constraint === 'email_identities_pkey';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly profiles: ProfileRepository,
    private readonly passwords: PasswordHasher,
    private readonly codes: EmailCodesService,
    private readonly sessions: SessionStore,
    private readonly jwt: JwtService,
    private readonly attempts: LoginAttempts,
  ) {}

  async register(input: { email: string; name: string; password: string; locale?: string }, meta: Meta) {
    const email = normalise(input.email);
    const emailKey = this.codes.emailKey(email);
    let user: UserRow;
    try {
      user = await this.profiles.register({
        email,
        emailKey,
        name: input.name.trim(),
        locale: input.locale ?? requestLocale(),
        passwordHash: await this.passwords.hash(input.password),
      });
    } catch (error) {
      if (isDuplicate(error)) {
        throw new AuthError('EMAIL_IN_USE');
      }
      throw error;
    }
    try {
      await this.codes.send('verify', user.email, user.locale);
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
      this.logger.warn('Verification delivery failed after registration');
    }
    return this.startSession(user, meta, true);
  }

  async login(email: string, password: string, meta: Meta) {
    const key = this.codes.emailKey(normalise(email));
    await this.attempts.claim(key);
    const user = await this.profiles.findByEmail(key);
    const valid = await this.passwords.verify(user?.password_hash ?? undefined, password);
    if (!user || !valid) throw new AuthError('INVALID_CREDENTIALS');
    await this.attempts.reset(key);
    return this.startSession(user, meta);
  }

  async requestCode(purpose: Exclude<EmailPurpose, 'verify'>, email: string) {
    const target = normalise(email);
    const user = await this.byEmail(target);
    if (purpose === 'login') {
      await this.codes.send(purpose, target, user?.locale);
    } else if (user) {
      try {
        await this.codes.send(purpose, user.email, user.locale);
      } catch (error) {
        if (!(error instanceof ServiceUnavailableException)) throw error;
        this.logger.warn('Password reset delivery failed');
      }
    }
  }

  async loginWithCode(email: string, code: string, meta: Meta) {
    const target = normalise(email);
    if (!(await this.codes.consume('login', target, code))) throw new AuthError('INVALID_EMAIL_CODE');
    const emailKey = this.codes.emailKey(target);
    let user = await this.profiles.findByEmail(emailKey);
    if (!user) {
      try {
        const created = await this.profiles.register({
          email: target,
          emailKey,
          name: target.slice(0, target.lastIndexOf('@')).slice(0, 120),
          locale: requestLocale(),
          passwordHash: null,
          verified: true,
        });
        return this.startSession(created, meta, true);
      } catch (error) {
        if (!isDuplicate(error)) throw error;
        user = await this.profiles.findByEmail(emailKey);
      }
    }
    if (!user) throw new AuthError('INVALID_CREDENTIALS');
    if (!user.email_verified_at) {
      const owner = identity(user);
      // Before verification, a password may have been set by someone without mailbox access.
      const claimed = await this.profiles.claimUnverifiedEmail(owner);
      if (claimed) {
        await this.sessions.revokeAll(owner);
        return this.startSession(claimed, meta);
      }
      const verified = await this.profiles.find(owner);
      if (!verified) throw new AuthError('INVALID_CREDENTIALS');
      return this.startSession(verified, meta);
    }
    return this.startSession(user, meta);
  }

  async requestVerification(actor: Actor) {
    const user = await this.profiles.find(actor);
    if (user && !user.email_verified_at) await this.codes.send('verify', user.email, user.locale);
  }

  async verifyEmail(actor: Actor, code: string) {
    const user = await this.profiles.find(actor);
    if (!user || !(await this.codes.consume('verify', user.email, code)))
      throw new AuthError('INVALID_EMAIL_CODE');
    await this.profiles.verifyEmail(actor);
  }

  async resetPassword(email: string, code: string, newPassword: string) {
    const user = await this.byEmail(email);
    if (!user || !(await this.codes.consume('reset', user.email, code)))
      throw new AuthError('INVALID_EMAIL_CODE');
    await this.replacePassword(user, newPassword, true);
    await this.attempts.reset(this.codes.emailKey(user.email));
  }

  async changePassword(actor: Actor, currentPassword: string | undefined, newPassword: string, meta: Meta) {
    const user = await this.profiles.find(actor);
    if (
      !user ||
      (user.password_hash && !(await this.passwords.verify(user.password_hash, currentPassword ?? '')))
    ) {
      throw new AuthError('INVALID_CREDENTIALS');
    }
    const updated = await this.replacePassword(user, newPassword);
    return this.startSession(updated, meta);
  }

  async refresh(token: string) {
    const next = await this.sessions.rotate(token);
    const user = await this.profiles.find(next.actor);
    if (!user || version(user) !== next.version || next.expiresIn <= 0) {
      await this.sessions.revoke(next.actor);
      throw new AuthError('SESSION_EXPIRED');
    }
    return { ...next, access: await this.issueAccess(next.actor, next.version) };
  }

  private byEmail(email: string) {
    return this.profiles.findByEmail(this.codes.emailKey(normalise(email)));
  }

  private async replacePassword(user: UserRow, newPassword: string, verifyEmail = false) {
    const actor = identity(user);
    const updated = await this.profiles.changePassword(
      actor,
      user.password_hash,
      await this.passwords.hash(newPassword),
      verifyEmail,
    );
    if (!updated) throw new AuthError('PASSWORD_CHANGED');
    await this.sessions.revokeAll(actor);
    return updated;
  }

  private async startSession(user: UserRow, meta: Meta, created = false) {
    const session = await this.sessions.create(identity(user), version(user), meta);
    const access = await this.issueAccess(session.actor, version(user));
    return { ...session, access, result: { created, emailVerified: Boolean(user.email_verified_at) } };
  }

  private issueAccess(actor: Actor, passwordVersion: string) {
    return this.jwt.signAsync(
      {
        sub: actor.userId,
        tenant_id: actor.tenantId,
        sid: actor.sessionId,
        ver: passwordVersion,
      },
      { expiresIn: ACCESS_SECONDS, issuer: 'geniebox', audience: 'geniebox-api', algorithm: 'HS256' },
    );
  }
}
