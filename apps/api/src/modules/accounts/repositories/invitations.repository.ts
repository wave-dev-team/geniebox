import { type Selectable, sql, type Transaction } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { AssignableRole } from '../../../common/auth/account-role.js';
import type { AccountInvitations, DB } from '../../../database/types.js';

export type InvitationRow = Selectable<AccountInvitations>;

@Injectable()
export class InvitationsRepository {
  insert(
    db: Transaction<DB>,
    values: {
      account_id: string;
      email: string;
      role: AssignableRole;
      token_hash: string;
      invited_by: string;
      expires_at: Date;
    },
  ): Promise<InvitationRow> {
    return db.insertInto('account_invitations').values(values).returningAll().executeTakeFirstOrThrow();
  }

  /** Revokes a pending invitation for the same email, if any (re-invite replaces it). */
  async revokePendingFor(db: Transaction<DB>, accountId: string, email: string): Promise<void> {
    await db
      .updateTable('account_invitations')
      .set({ revoked_at: new Date() })
      .where('account_id', '=', accountId)
      .where('email', '=', email)
      .where('accepted_at', 'is', null)
      .where('revoked_at', 'is', null)
      .execute();
  }

  listPending(db: Transaction<DB>, accountId: string): Promise<InvitationRow[]> {
    return db
      .selectFrom('account_invitations')
      .selectAll()
      .where('account_id', '=', accountId)
      .where('accepted_at', 'is', null)
      .where('revoked_at', 'is', null)
      .orderBy('created_at', 'desc')
      .execute();
  }

  async revoke(db: Transaction<DB>, accountId: string, id: string): Promise<InvitationRow | undefined> {
    return db
      .updateTable('account_invitations')
      .set({ revoked_at: new Date() })
      .where('account_id', '=', accountId)
      .where('id', '=', id)
      .where('accepted_at', 'is', null)
      .where('revoked_at', 'is', null)
      .returningAll()
      .executeTakeFirst();
  }

  /** System role: the token identifies the account, which is not in context yet. */
  findByTokenHashForUpdate(system: Transaction<DB>, tokenHash: string): Promise<InvitationRow | undefined> {
    return system
      .selectFrom('account_invitations')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .forUpdate()
      .executeTakeFirst();
  }

  async markAccepted(system: Transaction<DB>, id: string, userId: string): Promise<void> {
    await system
      .updateTable('account_invitations')
      .set({ accepted_at: sql<Date>`now()`, accepted_by: userId })
      .where('id', '=', id)
      .execute();
  }
}
