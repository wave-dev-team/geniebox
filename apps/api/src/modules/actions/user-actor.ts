import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import type { AccountRole } from '../../common/auth/account-role.js';
import type { AppClsStore } from '../../common/context/app-cls-store.js';
import { runInContext } from '../../common/context/run-in-context.js';
import { SystemDb } from '../../database/system-db.js';

export interface UserProject {
  projectId: string;
  accountId: string;
  name: string;
  slug: string;
  role: AccountRole;
}

export interface Acting {
  userId: string;
  accountId: string;
  role: AccountRole;
  projectId?: string;
}

/**
 * Runs service code as a person, outside HTTP (buttons, the manager's panel tools):
 * the same context the guards build — user, account, the role from membership, project — so
 * services check and journal exactly as in the panel.
 */
@Injectable()
export class UserActor {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    // SystemDb: a button press knows only the user; membership is looked
    // up across accounts (ids, names and roles only).
    private readonly systemDb: SystemDb,
  ) {}

  /** Live projects of the user with the role in each project's account. */
  projects(userId: string): Promise<UserProject[]> {
    return this.systemDb.transaction(async (trx) => {
      const rows = await trx
        .selectFrom('projects as p')
        .innerJoin('account_members as m', 'm.account_id', 'p.account_id')
        .select(['p.id', 'p.account_id', 'p.name', 'p.slug', 'm.role', 'p.created_at'])
        .where('m.user_id', '=', userId)
        .where('p.deleted_at', 'is', null)
        .orderBy('p.created_at')
        .execute();
      return rows.map((row) => ({
        projectId: row.id,
        accountId: row.account_id,
        name: row.name,
        slug: row.slug,
        role: row.role as AccountRole,
      }));
    });
  }

  async project(userId: string, projectId: string): Promise<UserProject | undefined> {
    return (await this.projects(userId)).find((project) => project.projectId === projectId);
  }

  async accountRole(userId: string, accountId: string): Promise<AccountRole | undefined> {
    const row = await this.systemDb.transaction((trx) =>
      trx
        .selectFrom('account_members')
        .select('role')
        .where('user_id', '=', userId)
        .where('account_id', '=', accountId)
        .executeTakeFirst(),
    );
    return row?.role as AccountRole | undefined;
  }

  async locale(userId: string): Promise<string> {
    const row = await this.systemDb.transaction((trx) =>
      trx.selectFrom('users').select('locale').where('id', '=', userId).executeTakeFirst(),
    );
    return row?.locale ?? 'ru';
  }

  run<T>(acting: Acting, fn: () => Promise<T>): Promise<T> {
    return runInContext(
      this.cls,
      { traceId: this.cls.getId() ?? randomUUID(), accountId: acting.accountId, userId: acting.userId },
      () => {
        this.cls.set('accountRole', acting.role);
        if (acting.projectId) this.cls.set('projectId', acting.projectId);
        return fn();
      },
    );
  }
}
