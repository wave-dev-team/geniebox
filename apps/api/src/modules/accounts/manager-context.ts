import { sql, type Transaction } from 'kysely';

import type { DB } from '../../database/types.js';

export function readManagerContext(db: Transaction<DB>, accountId: string, userId: string) {
  return db
    .selectFrom('account_members')
    .innerJoin('accounts', 'accounts.id', 'account_members.account_id')
    .select([
      'account_members.role',
      sql<
        string | null
      >`greatest(account_members.manager_context_reset_at, accounts.manager_context_reset_at)::text`.as(
        'historySince',
      ),
      sql<string | null>`accounts.manager_context_reset_at::text`.as('accountSince'),
    ])
    .where('account_members.account_id', '=', accountId)
    .where('account_members.user_id', '=', userId)
    .executeTakeFirst();
}
