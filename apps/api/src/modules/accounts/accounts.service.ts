import { sql } from 'kysely';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';

import type { AccountRole } from '../../common/auth/account-role.js';
import type { AppClsStore } from '../../common/context/app-cls-store.js';
import type { Locale } from '../../common/i18n/locales.js';
import type { Env } from '../../config/env.schema.js';
import { AccountDb, UserDb } from '../../database/scoped-db.js';
import { SystemDb } from '../../database/system-db.js';
import { JournalService } from '../../journal/journal.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { StreamPublisher } from '../stream/stream.publisher.js';
import { AccountContext } from './account-context.js';
import { ACCOUNT_ERRORS, AccountException } from './accounts.errors.js';
import { ACCOUNT_EVENTS, type AccountCreatedEvent, type MemberEvent } from './events/account.events.js';
import {
  type AccountRow,
  AccountsRepository,
  type AccountWithRole,
} from './repositories/accounts.repository.js';
import { MembersRepository } from './repositories/members.repository.js';
import { randomSuffix, slugify } from './slug.js';

export interface CreateAccountInput {
  name: string;
  slug?: string;
  locale?: Locale;
}

const SLUG_ATTEMPTS = 5;

@Injectable()
export class AccountsService {
  private readonly maxAccountsPerUser: number;

  constructor(
    // SystemDb: a new account cannot be created inside its own (not yet existing) context.
    private readonly systemDb: SystemDb,
    private readonly accountDb: AccountDb,
    private readonly userDb: UserDb,
    private readonly accounts: AccountsRepository,
    private readonly members: MembersRepository,
    private readonly journal: JournalService,
    private readonly outbox: OutboxService,
    private readonly stream: StreamPublisher,
    private readonly context: AccountContext,
    private readonly cls: ClsService<AppClsStore>,
    config: ConfigService<Env, true>,
  ) {
    this.maxAccountsPerUser = config.get('MAX_ACCOUNTS_PER_USER', { infer: true });
  }

  /** Creates an account owned by the current user. */
  async create(input: CreateAccountInput): Promise<AccountWithRole> {
    const userId = this.context.userId();
    const owned = await this.userDb.transaction((tx) => this.members.countForUser(tx.db, userId));
    if (owned >= this.maxAccountsPerUser) {
      throw new AccountException(ACCOUNT_ERRORS.ACCOUNT_LIMIT_REACHED, {
        messageArgs: { limit: this.maxAccountsPerUser },
      });
    }

    return this.systemDb.transaction(async (trx) => {
      const slug = await this.pickSlug(trx, input);
      const account = await this.accounts.insert(trx, {
        slug,
        name: input.name,
        locale: input.locale ?? 'ru',
      });
      await this.members.insert(trx, account.id, userId, 'owner');

      const context = { db: trx, accountId: account.id, traceId: this.cls.getId() };
      await this.journal.record(context, {
        actor: { type: 'user', id: userId, role: 'owner' },
        action: 'accounts.create',
        target: { type: 'account', id: account.id },
        args: { name: input.name, slug },
        status: 'succeeded',
      });
      await this.outbox.add<AccountCreatedEvent>(context, {
        type: ACCOUNT_EVENTS.CREATED,
        payload: { accountId: account.id, ownerUserId: userId },
      });
      await this.outbox.add<MemberEvent>(context, {
        type: ACCOUNT_EVENTS.MEMBER_ADDED,
        payload: { accountId: account.id, userId, role: 'owner', byUserId: userId },
      });
      return { ...account, role: 'owner' as AccountRole };
    });
  }

  listMine(): Promise<AccountWithRole[]> {
    return this.userDb.transaction((tx) => this.accounts.listForUser(tx.db, tx.userId));
  }

  async getCurrent(): Promise<AccountWithRole> {
    const actor = this.context.actor();
    const account = await this.accountDb.transaction((tx) => this.accounts.findById(tx.db, tx.accountId));
    if (!account) {
      throw new AccountException(ACCOUNT_ERRORS.ACCOUNT_NOT_FOUND);
    }
    return { ...account, role: actor.role };
  }

  async updateCurrent(values: { name?: string; locale?: Locale }): Promise<AccountWithRole> {
    const actor = this.context.actor();
    const account = await this.accountDb.transaction(async (tx): Promise<AccountRow | undefined> => {
      const updated = await this.accounts.update(tx.db, tx.accountId, values);
      await this.journal.record(tx, {
        actor: { type: 'user', id: actor.userId, role: actor.role },
        action: 'accounts.update',
        target: { type: 'account', id: tx.accountId },
        args: values,
        status: 'succeeded',
      });
      await this.outbox.add(tx, {
        type: ACCOUNT_EVENTS.UPDATED,
        payload: { accountId: tx.accountId },
      });
      return updated;
    });
    if (!account) {
      throw new AccountException(ACCOUNT_ERRORS.ACCOUNT_NOT_FOUND);
    }
    return { ...account, role: actor.role };
  }

  async resetManagerContext(scope: 'personal' | 'account'): Promise<void> {
    const { userId, role } = this.context.actor();
    await this.accountDb.transaction(async (tx) => {
      const resetAt = sql<Date>`clock_timestamp()`;
      if (scope === 'personal') {
        const member = await tx.db
          .updateTable('account_members')
          .set({ manager_context_reset_at: resetAt })
          .where('account_id', '=', tx.accountId)
          .where('user_id', '=', userId)
          .returning('user_id')
          .executeTakeFirst();
        if (!member) throw new AccountException(ACCOUNT_ERRORS.ACCOUNT_NOT_FOUND);
      } else {
        const owner = await tx.db
          .selectFrom('account_members')
          .select('user_id')
          .where('account_id', '=', tx.accountId)
          .where('user_id', '=', userId)
          .where('role', '=', 'owner')
          .forShare()
          .executeTakeFirst();
        if (!owner) throw new AccountException(ACCOUNT_ERRORS.OWNER_REQUIRED);
        const account = await tx.db
          .updateTable('accounts')
          .set({ manager_context_reset_at: resetAt })
          .where('id', '=', tx.accountId)
          .returning('id')
          .executeTakeFirst();
        if (!account) throw new AccountException(ACCOUNT_ERRORS.ACCOUNT_NOT_FOUND);
      }
      await this.journal.record(tx, {
        actor: { type: 'user', id: userId, role },
        action: 'accounts.manager_context.reset',
        target: { type: 'account', id: tx.accountId },
        args: { scope },
        status: 'succeeded',
      });
      const projects = await tx.db
        .selectFrom('projects')
        .select('id')
        .where('account_id', '=', tx.accountId)
        .where('deleted_at', 'is', null)
        .execute();
      tx.afterCommit(async () => {
        await Promise.all(
          projects.map(({ id }) =>
            this.stream.publish(id, {
              type: 'manager.context_reset',
              recipientUserId: scope === 'personal' ? userId : null,
            }),
          ),
        );
      });
    });
  }

  private async pickSlug(trx: Parameters<AccountsRepository['slugExists']>[0], input: CreateAccountInput) {
    if (input.slug) {
      if (await this.accounts.slugExists(trx, input.slug)) {
        throw new AccountException(ACCOUNT_ERRORS.ACCOUNT_SLUG_TAKEN, {
          messageArgs: { slug: input.slug },
        });
      }
      return input.slug;
    }
    const base = slugify(input.name);
    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base.slice(0, 55)}-${randomSuffix()}`;
      if (!(await this.accounts.slugExists(trx, candidate))) {
        return candidate;
      }
    }
    return `account-${randomSuffix()}${randomSuffix()}`;
  }
}
