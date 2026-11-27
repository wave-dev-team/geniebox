import { type Selectable, sql, type Transaction } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { AccountRole } from '../../../common/auth/account-role.js';
import type { Accounts, DB } from '../../../database/types.js';

export type AccountRow = Selectable<Accounts>;
export type AccountWithRole = AccountRow & { role: AccountRole };

@Injectable()
export class AccountsRepository {
  insert(db: Transaction<DB>, values: { slug: string; name: string; locale: string }): Promise<AccountRow> {
    return db.insertInto('accounts').values(values).returningAll().executeTakeFirstOrThrow();
  }

  async slugExists(db: Transaction<DB>, slug: string): Promise<boolean> {
    const row = await db.selectFrom('accounts').select('id').where('slug', '=', slug).executeTakeFirst();
    return row !== undefined;
  }

  findById(db: Transaction<DB>, id: string): Promise<AccountRow | undefined> {
    return db.selectFrom('accounts').selectAll().where('id', '=', id).executeTakeFirst();
  }

  /** Under UserDb RLS: accounts the user is a member of. */
  listForUser(db: Transaction<DB>, userId: string): Promise<AccountWithRole[]> {
    return db
      .selectFrom('accounts')
      .innerJoin('account_members', 'account_members.account_id', 'accounts.id')
      .selectAll('accounts')
      .select(sql<AccountRole>`account_members.role`.as('role'))
      .where('account_members.user_id', '=', userId)
      .orderBy('accounts.created_at')
      .execute();
  }

  update(
    db: Transaction<DB>,
    id: string,
    values: { name?: string; locale?: string },
  ): Promise<AccountRow | undefined> {
    return db.updateTable('accounts').set(values).where('id', '=', id).returningAll().executeTakeFirst();
  }
}
