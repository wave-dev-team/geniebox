import { sql, type Transaction } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { AccountRole } from '../../../common/auth/account-role.js';
import type { DB } from '../../../database/types.js';

export interface MemberView {
  userId: string;
  email: string;
  displayName: string | null;
  role: AccountRole;
  joinedAt: Date;
}

@Injectable()
export class MembersRepository {
  async insert(db: Transaction<DB>, accountId: string, userId: string, role: AccountRole): Promise<void> {
    await db.insertInto('account_members').values({ account_id: accountId, user_id: userId, role }).execute();
  }

  async findRole(db: Transaction<DB>, accountId: string, userId: string): Promise<AccountRole | undefined> {
    const row = await db
      .selectFrom('account_members')
      .select(sql<AccountRole>`role`.as('role'))
      .where('account_id', '=', accountId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return row?.role;
  }

  /** Locks the membership row: role checks and the change happen atomically. */
  async findRoleForUpdate(
    db: Transaction<DB>,
    accountId: string,
    userId: string,
  ): Promise<AccountRole | undefined> {
    const row = await db
      .selectFrom('account_members')
      .select(sql<AccountRole>`role`.as('role'))
      .where('account_id', '=', accountId)
      .where('user_id', '=', userId)
      .forUpdate()
      .executeTakeFirst();
    return row?.role;
  }

  async countForUser(db: Transaction<DB>, userId: string): Promise<number> {
    const row = await db
      .selectFrom('account_members')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  list(db: Transaction<DB>, accountId: string): Promise<MemberView[]> {
    return db
      .selectFrom('account_members as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select([
        'm.user_id as userId',
        'u.email as email',
        'u.display_name as displayName',
        sql<AccountRole>`m.role`.as('role'),
        'm.created_at as joinedAt',
      ])
      .where('m.account_id', '=', accountId)
      .orderBy('m.created_at')
      .execute();
  }

  async findUserIdByEmail(
    db: Transaction<DB>,
    accountId: string,
    email: string,
  ): Promise<string | undefined> {
    const row = await db
      .selectFrom('account_members as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select('m.user_id')
      .where('m.account_id', '=', accountId)
      .where('u.email', '=', email)
      .executeTakeFirst();
    return row?.user_id;
  }

  async updateRole(db: Transaction<DB>, accountId: string, userId: string, role: AccountRole): Promise<void> {
    await db
      .updateTable('account_members')
      .set({ role })
      .where('account_id', '=', accountId)
      .where('user_id', '=', userId)
      .execute();
  }

  async delete(db: Transaction<DB>, accountId: string, userId: string): Promise<void> {
    await db
      .deleteFrom('account_members')
      .where('account_id', '=', accountId)
      .where('user_id', '=', userId)
      .execute();
  }
}
