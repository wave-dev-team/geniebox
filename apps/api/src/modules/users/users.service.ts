import type { Transaction } from 'kysely';

import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../common/context/app-cls-store.js';
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenActionException,
} from '../../common/exceptions/index.js';
import type { Locale } from '../../common/i18n/locales.js';
import { UserDb } from '../../database/scoped-db.js';
import { SystemDb } from '../../database/system-db.js';
import type { DB } from '../../database/types.js';
import { JournalService } from '../../journal/journal.service.js';
import type { JournalStatus } from '../../journal/journal.types.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { normalizeEmail } from './email.js';
import {
  type RegistrationMethod,
  USER_EMAIL_VERIFIED,
  USER_PASSWORD_CHANGED,
  USER_REGISTERED,
  type UserEventPayload,
  type UserRegisteredEvent,
} from './events/user.events.js';
import {
  type IdentityProvider,
  type PublicUserRow,
  type UserRow,
  UsersRepository,
} from './repositories/users.repository.js';

export const USER_ERRORS = {
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  USER_BLOCKED: 'USER_BLOCKED',
} as const;

export interface ExternalIdentity {
  provider: IdentityProvider;
  subject: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
}

export interface Profile extends PublicUserRow {
  hasPassword: boolean;
  identityProviders: IdentityProvider[];
}

/**
 * Users are platform-level (not owned by an account). Auth flows run before a user is in
 * context, so they use SystemDb; profile operations run under UserDb (RLS: self only).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly systemDb: SystemDb,
    private readonly userDb: UserDb,
    private readonly repository: UsersRepository,
    private readonly journal: JournalService,
    private readonly outbox: OutboxService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  findByEmail(email: string): Promise<UserRow | undefined> {
    return this.systemDb.transaction((trx) => this.repository.findByEmail(trx, normalizeEmail(email)));
  }

  async getActiveById(id: string): Promise<UserRow> {
    const user = await this.systemDb.transaction((trx) => this.repository.findById(trx, id));
    if (!user) {
      throw new EntityNotFoundException(USER_ERRORS.USER_NOT_FOUND);
    }
    assertActive(user);
    return user;
  }

  async registerWithPassword(input: {
    email: string;
    passwordHash: string;
    displayName?: string;
    locale?: Locale;
  }): Promise<UserRow> {
    const email = normalizeEmail(input.email);
    return this.systemDb.transaction(async (trx) => {
      if (await this.repository.findByEmail(trx, email)) {
        throw new ConflictException(USER_ERRORS.EMAIL_TAKEN);
      }
      const user = await this.repository.insert(trx, {
        email,
        password_hash: input.passwordHash,
        password_changed_at: new Date(),
        display_name: input.displayName ?? null,
        locale: input.locale ?? 'ru',
      });
      await this.recordRegistration(trx, user, 'password');
      return user;
    });
  }

  /** Email-code sign-in: the code proved ownership, so the email is verified. */
  async findOrCreateVerified(email: string, locale?: Locale): Promise<{ user: UserRow; created: boolean }> {
    const normalized = normalizeEmail(email);
    return this.systemDb.transaction(async (trx) => {
      const existing = await this.repository.findByEmail(trx, normalized);
      if (existing) {
        assertActive(existing);
        await this.verifyInTx(trx, existing.id);
        return { user: existing, created: false };
      }
      const user = await this.repository.insert(trx, {
        email: normalized,
        email_verified_at: new Date(),
        locale: locale ?? 'ru',
      });
      await this.recordRegistration(trx, user, 'email_code');
      return { user, created: true };
    });
  }

  /**
   * Resolves a Google/Apple identity: known identity → its user; otherwise link to the user
   * with the same email only if the provider verified that email; otherwise create a user.
   */
  async resolveExternalIdentity(identity: ExternalIdentity, locale?: Locale): Promise<UserRow> {
    const email = normalizeEmail(identity.email);
    return this.systemDb.transaction(async (trx) => {
      const linked = await this.repository.findIdentity(trx, identity.provider, identity.subject);
      if (linked) {
        const user = await this.repository.findById(trx, linked.user_id);
        if (!user) {
          throw new EntityNotFoundException(USER_ERRORS.USER_NOT_FOUND);
        }
        assertActive(user);
        return user;
      }

      const existing = await this.repository.findByEmail(trx, email);
      if (existing) {
        // An unverified provider email must never grant access to an existing account.
        if (!identity.emailVerified) {
          throw new ConflictException(USER_ERRORS.EMAIL_TAKEN);
        }
        assertActive(existing);
        await this.repository.insertIdentity(trx, {
          user_id: existing.id,
          provider: identity.provider,
          subject: identity.subject,
          email,
        });
        await this.verifyInTx(trx, existing.id);
        await this.record(trx, existing.id, `users.identity.link.${identity.provider}`, 'succeeded');
        return existing;
      }

      const user = await this.repository.insert(trx, {
        email,
        email_verified_at: identity.emailVerified ? new Date() : null,
        display_name: identity.displayName ?? null,
        locale: locale ?? 'ru',
      });
      await this.repository.insertIdentity(trx, {
        user_id: user.id,
        provider: identity.provider,
        subject: identity.subject,
        email,
      });
      await this.recordRegistration(trx, user, identity.provider);
      return user;
    });
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    await this.systemDb.transaction(async (trx) => {
      await this.repository.setPassword(trx, userId, passwordHash);
      await this.record(trx, userId, 'users.password.change', 'succeeded');
      await this.outbox.add<UserEventPayload>(this.platformContext(trx), {
        type: USER_PASSWORD_CHANGED,
        payload: { userId },
      });
    });
  }

  async markEmailVerified(userId: string): Promise<void> {
    await this.systemDb.transaction((trx) => this.verifyInTx(trx, userId));
  }

  /** Records a security-relevant user action that is not tied to an account (sign-in etc.). */
  /** Last activity of the user: sign-in and token refresh. */
  async touchLastSeen(userId: string): Promise<void> {
    await this.systemDb.db
      .updateTable('users')
      .set({ last_seen_at: new Date() })
      .where('id', '=', userId)
      .execute();
  }

  async recordPlatformAction(
    userId: string,
    action: string,
    status: JournalStatus,
    args?: unknown,
  ): Promise<void> {
    await this.systemDb.transaction((trx) => this.record(trx, userId, action, status, args));
  }

  async getProfile(): Promise<Profile> {
    const profile = await this.userDb.transaction(async (tx) => {
      const user = await this.repository.findSelf(tx.db, tx.userId);
      const providers = await this.repository.listIdentityProviders(tx.db, tx.userId);
      return user ? { user, providers } : undefined;
    });
    if (!profile) {
      throw new EntityNotFoundException(USER_ERRORS.USER_NOT_FOUND);
    }
    // password_hash is not readable by the app role; ask the system role for a boolean only.
    const hasPassword = await this.systemDb.transaction(async (trx) => {
      const row = await this.repository.findById(trx, profile.user.id);
      return Boolean(row?.password_hash);
    });
    return {
      ...profile.user,
      hasPassword,
      identityProviders: profile.providers,
    };
  }

  async updateProfile(values: {
    displayName?: string | null;
    locale?: Locale;
    timezone?: string | null;
  }): Promise<Profile> {
    await this.userDb.transaction((tx) =>
      this.repository.updateSelf(tx.db, tx.userId, {
        ...(values.displayName === undefined ? {} : { display_name: values.displayName }),
        ...(values.locale === undefined ? {} : { locale: values.locale }),
        ...(values.timezone === undefined ? {} : { timezone: values.timezone }),
      }),
    );
    return this.getProfile();
  }

  private async verifyInTx(trx: Transaction<DB>, userId: string): Promise<void> {
    if (await this.repository.markEmailVerified(trx, userId)) {
      await this.outbox.add<UserEventPayload>(this.platformContext(trx), {
        type: USER_EMAIL_VERIFIED,
        payload: { userId },
      });
    }
  }

  private async recordRegistration(
    trx: Transaction<DB>,
    user: UserRow,
    method: RegistrationMethod,
  ): Promise<void> {
    await this.record(trx, user.id, 'users.register', 'succeeded', { method });
    await this.outbox.add<UserRegisteredEvent>(this.platformContext(trx), {
      type: USER_REGISTERED,
      payload: { userId: user.id, method },
    });
  }

  private async record(
    trx: Transaction<DB>,
    userId: string,
    action: string,
    status: JournalStatus,
    args?: unknown,
  ): Promise<void> {
    await this.journal.record(this.platformContext(trx), {
      actor: { type: 'user', id: userId },
      action,
      target: { type: 'user', id: userId },
      args,
      status,
    });
  }

  private platformContext(trx: Transaction<DB>) {
    return { db: trx, accountId: null, traceId: this.cls.getId() };
  }
}

function assertActive(user: UserRow): void {
  if (user.status !== 'active') {
    throw new ForbiddenActionException(USER_ERRORS.USER_BLOCKED);
  }
}
