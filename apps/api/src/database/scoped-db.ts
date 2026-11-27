import { type Kysely, sql, type Transaction } from 'kysely';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../common/context/app-cls-store.js';
import { AccountContextMissingException, UserContextMissingException } from '../common/exceptions/index.js';
import { APP_KYSELY } from './database.tokens.js';
import type { DB } from './types.js';

type AfterCommitCallback = () => void | Promise<void>;

interface ScopedTxBase {
  readonly db: Transaction<DB>;
  readonly traceId: string;
  /**
   * Runs after a successful commit, never on rollback. For in-process events and cache
   * invalidation only; anything that must not be lost goes through the outbox.
   */
  afterCommit(callback: AfterCommitCallback): void;
}

/** Unit of work bound to one account (and the acting user, if any). */
export interface AccountTx extends ScopedTxBase {
  readonly accountId: string;
  readonly userId: string | undefined;
}

/** Unit of work bound to the acting user, possibly outside any account. */
export interface UserTx extends ScopedTxBase {
  readonly userId: string;
  readonly accountId: string | undefined;
}

interface Scope {
  accountId: string | undefined;
  userId: string | undefined;
}

/**
 * Runs work in a transaction on the app role with `app.account_id` / `app.user_id` set
 * transaction-locally: RLS restricts rows even if a query forgets a filter, and the settings
 * cannot leak to the next user of the pooled connection.
 */
@Injectable()
class ScopedTransactionRunner {
  private readonly logger = new Logger('ScopedDb');

  constructor(
    @Inject(APP_KYSELY) private readonly db: Kysely<DB>,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  scope(): Scope {
    if (!this.cls.isActive()) {
      return { accountId: undefined, userId: undefined };
    }
    return { accountId: this.cls.get('accountId'), userId: this.cls.get('userId') };
  }

  async run<T>(scope: Scope, work: (base: ScopedTxBase) => Promise<T>): Promise<T> {
    const callbacks: AfterCommitCallback[] = [];
    const traceId = this.cls.getId();
    const result = await this.db.transaction().execute(async (trx) => {
      await sql`
        SELECT set_config('app.account_id', ${scope.accountId ?? ''}, true),
               set_config('app.user_id', ${scope.userId ?? ''}, true)
      `.execute(trx);
      return work({ db: trx, traceId, afterCommit: (callback) => callbacks.push(callback) });
    });
    for (const callback of callbacks) {
      try {
        await callback();
      } catch (error) {
        // Already committed: a failing side effect must not turn the call into an error.
        this.logger.error({ err: error }, 'afterCommit callback failed');
      }
    }
    return result;
  }
}

/** The only way to touch account-owned data. Requires an account in context. */
@Injectable()
export class AccountDb {
  constructor(private readonly runner: ScopedTransactionRunner) {}

  transaction<T>(work: (tx: AccountTx) => Promise<T>): Promise<T> {
    const scope = this.runner.scope();
    const accountId = scope.accountId;
    if (!accountId) {
      throw new AccountContextMissingException();
    }
    return this.runner.run(scope, (base) => work({ ...base, accountId, userId: scope.userId }));
  }
}

/** Access on behalf of the signed-in user across accounts ("my profile", "my accounts"). */
@Injectable()
export class UserDb {
  constructor(private readonly runner: ScopedTransactionRunner) {}

  transaction<T>(work: (tx: UserTx) => Promise<T>): Promise<T> {
    const scope = this.runner.scope();
    const userId = scope.userId;
    if (!userId) {
      throw new UserContextMissingException();
    }
    return this.runner.run(scope, (base) => work({ ...base, userId, accountId: scope.accountId }));
  }
}

export const SCOPED_DB_PROVIDERS = [ScopedTransactionRunner, AccountDb, UserDb];
