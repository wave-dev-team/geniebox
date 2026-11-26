import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import type { ProfileUpdate } from '@workspace/types';

import { IdentityDirectory } from '../../../database/identity-directory.js';
import { type RequestContext, TenantDb } from '../../../database/tenant-db.js';
import { JournalService } from '../../../journal/journal.service.js';

export interface Identity {
  tenantId: string;
  userId: string;
}

@Injectable()
export class UsersRepository {
  constructor(
    private readonly db: TenantDb,
    private readonly directory: IdentityDirectory,
    private readonly context: ClsService<RequestContext>,
    private readonly journal: JournalService,
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
    const traceId = this.context.getId() ?? randomUUID();
    return this.context.runWith({ tenantId }, () =>
      this.db.transaction(async (tx) => {
        const profile = await tx
          .updateTable('user_profiles')
          .set({ name: input.name, locale: input.locale, timezone: input.timeZone })
          .where('id', '=', userId)
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.journal.append(tx, {
          tenantId,
          traceId,
          action: 'user.profile_updated',
          targetId: userId,
          actor: { kind: 'user', id: userId },
        });
        return profile;
      }),
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
