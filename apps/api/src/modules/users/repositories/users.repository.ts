import type { Selectable, Transaction } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { DB, UserIdentities, Users } from '../../../database/types.js';

export type UserRow = Selectable<Users>;
export type PublicUserRow = Omit<UserRow, 'password_hash'>;
export type IdentityProvider = 'google' | 'apple';
export type IdentityRow = Selectable<UserIdentities>;

// Columns readable by the app role (password_hash is not granted to it).
const PUBLIC_COLUMNS = [
  'id',
  'email',
  'email_verified_at',
  'display_name',
  'locale',
  'timezone',
  'password_changed_at',
  'status',
  'created_at',
  'updated_at',
  'blocked_at',
  'blocked_reason',
  'last_seen_at',
] as const;

export interface InsertUser {
  email: string;
  password_hash?: string | null;
  email_verified_at?: Date | null;
  display_name?: string | null;
  locale?: string;
  password_changed_at?: Date | null;
}

/**
 * Methods taking `system` run on the system role (auth flows: lookups by email before a user
 * is known). Methods taking `scoped` run under UserDb/AccountDb and are filtered by RLS.
 */
@Injectable()
export class UsersRepository {
  findByEmail(system: Transaction<DB>, email: string): Promise<UserRow | undefined> {
    return system.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst();
  }

  findById(system: Transaction<DB>, id: string): Promise<UserRow | undefined> {
    return system.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
  }

  insert(system: Transaction<DB>, values: InsertUser): Promise<UserRow> {
    return system.insertInto('users').values(values).returningAll().executeTakeFirstOrThrow();
  }

  async setPassword(system: Transaction<DB>, id: string, passwordHash: string): Promise<void> {
    await system
      .updateTable('users')
      .set({ password_hash: passwordHash, password_changed_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /** Returns true if the email was not verified before. */
  async markEmailVerified(system: Transaction<DB>, id: string): Promise<boolean> {
    const result = await system
      .updateTable('users')
      .set({ email_verified_at: new Date() })
      .where('id', '=', id)
      .where('email_verified_at', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  findIdentity(
    system: Transaction<DB>,
    provider: IdentityProvider,
    subject: string,
  ): Promise<IdentityRow | undefined> {
    return system
      .selectFrom('user_identities')
      .selectAll()
      .where('provider', '=', provider)
      .where('subject', '=', subject)
      .executeTakeFirst();
  }

  async insertIdentity(
    system: Transaction<DB>,
    values: { user_id: string; provider: IdentityProvider; subject: string; email: string | null },
  ): Promise<void> {
    await system.insertInto('user_identities').values(values).execute();
  }

  findSelf(scoped: Transaction<DB>, id: string): Promise<PublicUserRow | undefined> {
    return scoped.selectFrom('users').select(PUBLIC_COLUMNS).where('id', '=', id).executeTakeFirst();
  }

  updateSelf(
    scoped: Transaction<DB>,
    id: string,
    values: { display_name?: string | null; locale?: string; timezone?: string | null },
  ): Promise<PublicUserRow | undefined> {
    return scoped
      .updateTable('users')
      .set(values)
      .where('id', '=', id)
      .returning(PUBLIC_COLUMNS)
      .executeTakeFirst();
  }

  listIdentityProviders(scoped: Transaction<DB>, userId: string): Promise<IdentityProvider[]> {
    return scoped
      .selectFrom('user_identities')
      .select('provider')
      .where('user_id', '=', userId)
      .execute()
      .then((rows) => rows.map((row) => row.provider as IdentityProvider));
  }
}
