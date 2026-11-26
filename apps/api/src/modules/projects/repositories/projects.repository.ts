import { type Insertable, type Selectable, sql, type Transaction, type Updateable } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { AccountRole } from '../../../common/auth/account-role.js';
import type { DB, Projects } from '../../../database/types.js';

export type ProjectRow = Selectable<Projects>;
export type ProjectInsert = Insertable<Projects>;
export type ProjectUpdate = Omit<
  Updateable<Projects>,
  'id' | 'account_id' | 'created_by' | 'created_at' | 'updated_at' | 'deleted_at'
>;
export type ProjectWithRole = ProjectRow & {
  role: AccountRole;
  account_name: string;
  account_blocked_at: Date | null;
  account_blocked_reason: string | null;
};

/** All queries skip soft-deleted projects unless they say otherwise. */
@Injectable()
export class ProjectsRepository {
  /** Returns undefined when the slug is taken (by any account): the caller picks another. */
  insertIfSlugFree(db: Transaction<DB>, values: ProjectInsert): Promise<ProjectRow | undefined> {
    return db
      .insertInto('projects')
      .values(values)
      .onConflict((oc) => oc.column('slug').where('deleted_at', 'is', null).doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  async countForAccount(db: Transaction<DB>, accountId: string): Promise<number> {
    const row = await db
      .selectFrom('projects')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('account_id', '=', accountId)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  findById(db: Transaction<DB>, id: string): Promise<ProjectRow | undefined> {
    return db
      .selectFrom('projects')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  listForAccount(db: Transaction<DB>, accountId: string): Promise<ProjectRow[]> {
    return db
      .selectFrom('projects')
      .selectAll()
      .where('account_id', '=', accountId)
      .where('deleted_at', 'is', null)
      .orderBy('created_at')
      .execute();
  }

  /** Under UserDb RLS: projects of every account the user is a member of. */
  listForUser(db: Transaction<DB>, userId: string): Promise<ProjectWithRole[]> {
    return db
      .selectFrom('projects')
      .innerJoin('account_members', 'account_members.account_id', 'projects.account_id')
      .innerJoin('accounts', 'accounts.id', 'projects.account_id')
      .selectAll('projects')
      .select(sql<AccountRole>`account_members.role`.as('role'))
      .select([
        'accounts.name as account_name',
        'accounts.blocked_at as account_blocked_at',
        'accounts.blocked_reason as account_blocked_reason',
      ])
      .where('account_members.user_id', '=', userId)
      .where('projects.deleted_at', 'is', null)
      .orderBy('projects.created_at')
      .execute();
  }

  update(db: Transaction<DB>, id: string, values: ProjectUpdate): Promise<ProjectRow | undefined> {
    return db
      .updateTable('projects')
      .set(values)
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returningAll()
      .executeTakeFirst();
  }

  async softDelete(db: Transaction<DB>, id: string): Promise<boolean> {
    const result = await db
      .updateTable('projects')
      .set({ deleted_at: new Date(), agents_paused: true })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  /** Hard delete of a soft-deleted project; no-op for live or already purged ones. */
  async purge(db: Transaction<DB>, id: string): Promise<boolean> {
    const result = await db
      .deleteFrom('projects')
      .where('id', '=', id)
      .where('deleted_at', 'is not', null)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }
}
