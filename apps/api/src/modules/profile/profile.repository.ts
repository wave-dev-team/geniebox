import { randomUUID } from 'node:crypto';

import type { Selectable } from 'kysely';

import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import { localeSchema, type Profile, type ProfileUpdate } from '@workspace/types';

import { IdentityDirectory } from '../../database/identity-directory.js';
import { type RequestContext, TenantDb } from '../../database/tenant-db.js';
import type { UserProfiles } from '../../database/types.js';

export interface Identity {
  tenantId: string;
  userId: string;
}

export function toProfile(user: Selectable<UserProfiles>): Profile {
  return {
    id: user.id,
    tenantId: user.tenant_id,
    email: user.email,
    name: user.name,
    locale: localeSchema.parse(user.locale),
    timeZone: user.timezone,
    emailVerified: Boolean(user.email_verified_at),
    passwordChangedAt: user.password_changed_at.toISOString(),
    hasPassword: Boolean(user.password_hash),
    connections: [],
  };
}

@Injectable()
export class ProfileRepository {
  constructor(
    private readonly db: TenantDb,
    private readonly directory: IdentityDirectory,
    private readonly context: ClsService<RequestContext>,
  ) {}

  async register(input: {
    emailKey: string;
    email: string;
    name: string;
    passwordHash: string | null;
    locale: string;
    verified?: boolean;
  }) {
    const tenantId = randomUUID();
    return this.context.runWith({ tenantId }, () =>
      this.db.transaction(async (tx) => {
        const row = await tx
          .insertInto('user_profiles')
          .values({
            tenant_id: tenantId,
            id: randomUUID(),
            email: input.email,
            name: input.name,
            locale: input.locale,
            password_hash: input.passwordHash,
            email_verified_at: input.verified ? new Date() : null,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await tx
          .insertInto('email_identities')
          .values({
            email_key: input.emailKey,
            tenant_id: tenantId,
            user_id: row.id,
          })
          .execute();
        return row;
      }),
    );
  }

  async findByEmail(emailKey: string) {
    const entry = await this.directory.find(emailKey);
    return entry ? this.find({ tenantId: entry.tenant_id, userId: entry.user_id }) : undefined;
  }

  find({ tenantId, userId }: Identity) {
    return this.context.runWith({ tenantId }, () =>
      this.db.transaction((tx) =>
        tx.selectFrom('user_profiles').selectAll().where('id', '=', userId).executeTakeFirst(),
      ),
    );
  }

  async name({ tenantId, userId }: Identity) {
    const row = await this.context.runWith({ tenantId }, () =>
      this.db.transaction((tx) =>
        tx.selectFrom('user_profiles').select('name').where('id', '=', userId).executeTakeFirstOrThrow(),
      ),
    );
    return row.name;
  }

  update({ tenantId, userId }: Identity, input: ProfileUpdate) {
    return this.context.runWith({ tenantId }, () =>
      this.db.transaction((tx) =>
        tx
          .updateTable('user_profiles')
          .set({ name: input.name, locale: input.locale, timezone: input.timeZone })
          .where('id', '=', userId)
          .returningAll()
          .executeTakeFirstOrThrow(),
      ),
    );
  }

  verifyEmail({ tenantId, userId }: Identity) {
    return this.context.runWith({ tenantId }, () =>
      this.db.transaction((tx) =>
        tx
          .updateTable('user_profiles')
          .set({ email_verified_at: new Date() })
          .where('id', '=', userId)
          .where('email_verified_at', 'is', null)
          .execute(),
      ),
    );
  }

  claimUnverifiedEmail({ tenantId, userId }: Identity) {
    return this.context.runWith({ tenantId }, () =>
      this.db.transaction((tx) =>
        tx
          .updateTable('user_profiles')
          .set({ email_verified_at: new Date(), password_hash: null, password_changed_at: new Date() })
          .where('id', '=', userId)
          .where('email_verified_at', 'is', null)
          .returningAll()
          .executeTakeFirst(),
      ),
    );
  }

  async changePassword(
    { tenantId, userId }: Identity,
    expectedHash: string | null,
    newHash: string,
    verifyEmail: boolean,
  ) {
    return this.context.runWith({ tenantId }, () =>
      this.db.transaction((tx) =>
        tx
          .updateTable('user_profiles')
          .set((eb) => ({
            password_hash: newHash,
            password_changed_at: new Date(),
            email_verified_at: verifyEmail
              ? eb.fn.coalesce('email_verified_at', eb.val(new Date()))
              : undefined,
          }))
          .where('id', '=', userId)
          .where('password_hash', 'is not distinct from', expectedHash)
          .returningAll()
          .executeTakeFirst(),
      ),
    );
  }
}
