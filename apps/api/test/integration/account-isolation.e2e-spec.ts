import { type Kysely, sql } from 'kysely';

import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../src/common/context/app-cls-store.js';
import { AccountContextMissingException } from '../../src/common/exceptions/index.js';
import { CoreModule } from '../../src/core.module.js';
import { APP_KYSELY } from '../../src/database/database.tokens.js';
import { AccountDb, UserDb } from '../../src/database/scoped-db.js';
import { SystemDb } from '../../src/database/system-db.js';
import type { DB } from '../../src/database/types.js';
import { AccountsModule } from '../../src/modules/accounts/accounts.module.js';
import { AccountsService } from '../../src/modules/accounts/accounts.service.js';
import { MailModule } from '../../src/modules/mail/mail.module.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { QueueRootModule } from '../../src/queues/queue-root.module.js';
import { ScheduledTasksService } from '../../src/scheduling/scheduled-tasks.service.js';
import {
  asAccount,
  asSystem,
  asUser,
  connectAs,
  flushRedis,
  infra,
  uniqueEmail,
  uniqueSlug,
} from '../support/helpers.js';

describe('account isolation (RLS)', () => {
  let moduleRef: TestingModule;
  let cls: ClsService<AppClsStore>;
  let accountDb: AccountDb;
  let tasks: ScheduledTasksService;
  let userA: string;
  let userB: string;
  let accountA: string;
  let accountB: string;

  async function createUserWithAccount(prefix: string): Promise<{ userId: string; accountId: string }> {
    const { user } = await asSystem(cls, () =>
      moduleRef.get(UsersService).findOrCreateVerified(uniqueEmail(prefix)),
    );
    const account = await asUser(cls, user.id, () =>
      moduleRef.get(AccountsService).create({ name: `Account ${prefix}`, slug: uniqueSlug(prefix) }),
    );
    return { userId: user.id, accountId: account.id };
  }

  beforeAll(async () => {
    await flushRedis();
    moduleRef = await Test.createTestingModule({
      imports: [CoreModule, QueueRootModule, MailModule, AccountsModule],
    }).compile();
    // Compiling a testing module re-installs the default logger.
    Logger.overrideLogger(false);
    await moduleRef.init();
    cls = moduleRef.get(ClsService);
    accountDb = moduleRef.get(AccountDb);
    tasks = moduleRef.get(ScheduledTasksService);
    ({ userId: userA, accountId: accountA } = await createUserWithAccount('a'));
    ({ userId: userB, accountId: accountB } = await createUserWithAccount('b'));
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('creating an account writes owner membership, journal entry and events atomically', async () => {
    const db = moduleRef.get(SystemDb).db;
    const member = await db
      .selectFrom('account_members')
      .select(['user_id', 'role'])
      .where('account_id', '=', accountA)
      .execute();
    expect(member).toEqual([{ user_id: userA, role: 'owner' }]);

    const journal = await db
      .selectFrom('action_journal')
      .select('action')
      .where('account_id', '=', accountA)
      .execute();
    expect(journal.map((row) => row.action)).toEqual(['accounts.create']);

    const events = await db
      .selectFrom('outbox_events')
      .select('type')
      .where('account_id', '=', accountA)
      .orderBy('id')
      .execute();
    expect(events.map((row) => row.type)).toEqual(['account.created', 'account.member_added']);
  });

  it('shows each account only its own rows', async () => {
    const taskId = await asAccount(cls, accountA, () =>
      accountDb.transaction((tx) => tasks.schedule(tx, { type: 'e2e.noop', payload: {}, runAt: new Date() })),
    );
    expect(taskId).toEqual(expect.any(String));

    const seenByB = await asAccount(cls, accountB, () =>
      accountDb.transaction((tx) => tx.db.selectFrom('scheduled_tasks').select('id').execute()),
    );
    expect(seenByB).toEqual([]);
  });

  it("does not let an account modify another account's rows by id", async () => {
    const taskId = await asAccount(cls, accountA, () =>
      accountDb.transaction((tx) => tasks.schedule(tx, { type: 'e2e.noop', payload: {}, runAt: new Date() })),
    );
    const cancelled = await asAccount(cls, accountB, () =>
      accountDb.transaction((tx) => tasks.cancel(tx, taskId as string)),
    );
    expect(cancelled).toBe(false);
  });

  it('rejects writes tagged with a foreign account_id', async () => {
    await expect(
      asAccount(cls, accountA, () =>
        accountDb.transaction((tx) =>
          tx.db
            .insertInto('scheduled_tasks')
            .values({ account_id: accountB, type: 'x', run_at: new Date(), trace_id: 't' })
            .execute(),
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('hides users and members of other accounts', async () => {
    const visible = await asAccount(
      cls,
      accountA,
      () =>
        accountDb.transaction(async (tx) => ({
          users: await tx.db.selectFrom('users').select('id').execute(),
          members: await tx.db.selectFrom('account_members').select('user_id').execute(),
        })),
      userA,
    );
    expect(visible.users.map((row) => row.id)).toEqual([userA]);
    expect(visible.members.map((row) => row.user_id)).toEqual([userA]);
  });

  it('lets a user see their own memberships across accounts, and nothing else', async () => {
    const accounts = await asUser(cls, userB, () => moduleRef.get(AccountsService).listMine());
    expect(accounts.map((account) => account.id)).toEqual([accountB]);

    const others = await asUser(cls, userB, () =>
      moduleRef
        .get(UserDb)
        .transaction((tx) => tx.db.selectFrom('accounts').select('id').where('id', '=', accountA).execute()),
    );
    expect(others).toEqual([]);
  });

  it('never exposes password hashes to the app role', async () => {
    await expect(
      asUser(cls, userA, () =>
        moduleRef
          .get(UserDb)
          .transaction((tx) => tx.db.selectFrom('users').select('password_hash').execute()),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('refuses an account membership without an owner', async () => {
    await expect(
      asAccount(cls, accountA, () =>
        accountDb.transaction((tx) =>
          tx.db.updateTable('account_members').set({ role: 'admin' }).where('user_id', '=', userA).execute(),
        ),
      ),
    ).rejects.toThrow(/must have an owner/);
  });

  it('refuses to run account queries without account context', async () => {
    await expect(
      asSystem(cls, () => accountDb.transaction((tx) => tx.db.selectFrom('accounts').selectAll().execute())),
    ).rejects.toBeInstanceOf(AccountContextMissingException);
  });

  it('app role sees nothing when no context is set', async () => {
    const appDb = connectAs(infra().env.DATABASE_URL as string);
    try {
      const { rows } = await sql<{ accounts: string; users: string }>`
        SELECT (SELECT count(*) FROM accounts) AS accounts, (SELECT count(*) FROM users) AS users
      `.execute(appDb);
      expect(rows[0]).toEqual({ accounts: '0', users: '0' });
    } finally {
      await appDb.destroy();
    }
  });

  it('does not leak context settings to the next user of a pooled connection', async () => {
    const pool = moduleRef.get<Kysely<DB>>(APP_KYSELY);
    await asAccount(cls, accountA, () => accountDb.transaction(() => Promise.resolve()), userA);
    // pg-pool hands out the most recently released client, i.e. the one the transaction used.
    const { rows } = await sql<{ account: string | null; user: string | null }>`
      SELECT nullif(current_setting('app.account_id', true), '') AS account,
             nullif(current_setting('app.user_id', true), '') AS user
    `.execute(pool);
    expect(rows[0]).toEqual({ account: null, user: null });
  });
});

describe('action journal', () => {
  it('is append-only even for the table owner', async () => {
    const owner = connectAs(infra().ownerUrl);
    try {
      await expect(sql`UPDATE action_journal SET action = 'tampered'`.execute(owner)).rejects.toThrow(
        /append-only/,
      );
      await expect(sql`DELETE FROM action_journal`.execute(owner)).rejects.toThrow(/append-only/);
      await expect(sql`TRUNCATE action_journal`.execute(owner)).rejects.toThrow(/append-only/);
    } finally {
      await owner.destroy();
    }
  });

  it('is not modifiable by the app role', async () => {
    const appDb = connectAs(infra().env.DATABASE_URL as string);
    try {
      await expect(sql`UPDATE action_journal SET action = 'tampered'`.execute(appDb)).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await appDb.destroy();
    }
  });
});
