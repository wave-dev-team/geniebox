import { jest } from '@jest/globals';
import { z } from 'zod';

import { Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../src/common/context/app-cls-store.js';
import { AccountDb } from '../../src/database/scoped-db.js';
import { SystemDb } from '../../src/database/system-db.js';
import { AccountsModule } from '../../src/modules/accounts/accounts.module.js';
import { AccountsService } from '../../src/modules/accounts/accounts.service.js';
import {
  ACCOUNT_EVENTS,
  type AccountCreatedEvent,
} from '../../src/modules/accounts/events/account.events.js';
import { MailModule } from '../../src/modules/mail/mail.module.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { OnOutboxEvent } from '../../src/outbox/on-outbox-event.decorator.js';
import { OutboxService } from '../../src/outbox/outbox.service.js';
import type { OutboxEnvelope } from '../../src/outbox/outbox.types.js';
import { ScheduledTaskRegistry } from '../../src/scheduling/scheduled-task.registry.js';
import { ScheduledTasksService } from '../../src/scheduling/scheduled-tasks.service.js';
import { ScheduledTasksSweeper } from '../../src/scheduling/scheduled-tasks.sweeper.js';
import { WorkerModule } from '../../src/worker.module.js';
import {
  asAccount,
  asSystem,
  asUser,
  eventually,
  flushRedis,
  uniqueEmail,
  uniqueSlug,
} from '../support/helpers.js';

const FLAKY_EVENT = 'e2e.flaky_happened';
const REMIND_TASK = 'e2e.remind';

@Injectable()
class Probe implements OnModuleInit {
  readonly created: Array<{ envelope: OutboxEnvelope<AccountCreatedEvent>; clsAccount?: string }> = [];
  readonly flakyAttempts: string[] = [];
  readonly reminders: Array<{ text: string; accountId: string }> = [];

  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly registry: ScheduledTaskRegistry,
  ) {}

  onModuleInit(): void {
    const reminders = this.reminders;
    this.registry.register({
      type: REMIND_TASK,
      payloadSchema: z.object({ text: z.string() }),
      handle(payload, context) {
        reminders.push({ text: payload.text, accountId: context.accountId });
        return Promise.resolve();
      },
    });
  }

  @OnOutboxEvent(ACCOUNT_EVENTS.CREATED)
  onAccountCreated(envelope: OutboxEnvelope<AccountCreatedEvent>): void {
    this.created.push({ envelope, clsAccount: this.cls.get('accountId') });
  }

  @OnOutboxEvent(FLAKY_EVENT)
  onFlaky(envelope: OutboxEnvelope): void {
    this.flakyAttempts.push(envelope.eventId);
    if (this.flakyAttempts.length === 1) {
      throw new Error('transient failure');
    }
  }
}

@Module({ providers: [Probe] })
class ProbeModule {}

describe('outbox relay and scheduled tasks (worker)', () => {
  let moduleRef: TestingModule;
  let cls: ClsService<AppClsStore>;
  let probe: Probe;
  let accountDb: AccountDb;
  let systemDb: SystemDb;
  let accountId: string;

  beforeAll(async () => {
    await flushRedis();
    moduleRef = await Test.createTestingModule({
      imports: [WorkerModule, MailModule, AccountsModule, ProbeModule],
    }).compile();
    // Compiling a testing module re-installs the default logger.
    Logger.overrideLogger(false);
    moduleRef.enableShutdownHooks();
    await moduleRef.init();
    cls = moduleRef.get(ClsService);
    probe = moduleRef.get(Probe);
    accountDb = moduleRef.get(AccountDb);
    systemDb = moduleRef.get(SystemDb);
    const { user } = await asSystem(cls, () =>
      moduleRef.get(UsersService).findOrCreateVerified(uniqueEmail('w')),
    );
    const account = await asUser(cls, user.id, () =>
      moduleRef.get(AccountsService).create({ name: 'W', slug: uniqueSlug('w') }),
    );
    accountId = account.id;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('delivers committed events to listeners inside the account context', async () => {
    const delivered = await eventually(() => {
      const match = probe.created.find((item) => item.envelope.accountId === accountId);
      expect(match).toBeDefined();
      return Promise.resolve(match);
    });
    expect(delivered?.clsAccount).toBe(accountId);
    expect(delivered?.envelope.payload.accountId).toBe(accountId);

    // The relay commits published_at after enqueueing, so delivery can win the race.
    await eventually(async () => {
      const row = await systemDb.db
        .selectFrom('outbox_events')
        .select('published_at')
        .where('account_id', '=', accountId)
        .executeTakeFirstOrThrow();
      expect(row.published_at).toBeInstanceOf(Date);
    });
  });

  it('drops events of a rolled-back transaction and skips afterCommit', async () => {
    const afterCommit = jest.fn<() => void>();
    await expect(
      asAccount(cls, accountId, () =>
        accountDb.transaction(async (tx) => {
          await moduleRef.get(OutboxService).add(tx, { type: 'e2e.never', payload: {} });
          tx.afterCommit(afterCommit);
          throw new Error('rollback');
        }),
      ),
    ).rejects.toThrow('rollback');

    const rows = await systemDb.db
      .selectFrom('outbox_events')
      .select('id')
      .where('type', '=', 'e2e.never')
      .execute();
    expect(rows).toEqual([]);
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it('retries a failed delivery with the same event id', async () => {
    await asAccount(cls, accountId, () =>
      accountDb.transaction((tx) =>
        moduleRef.get(OutboxService).add(tx, { type: FLAKY_EVENT, payload: { n: 1 } }),
      ),
    );
    await eventually(() => {
      expect(probe.flakyAttempts).toHaveLength(2);
      return Promise.resolve();
    }, 15_000);
    expect(new Set(probe.flakyAttempts).size).toBe(1);
  });

  it('runs due scheduled tasks through the sweeper and marks them succeeded', async () => {
    const scheduler = moduleRef.get(ScheduledTasksService);
    const [dueId, futureId, unknownId] = await asAccount(cls, accountId, () =>
      accountDb.transaction(async (tx) => [
        await scheduler.schedule(tx, {
          type: REMIND_TASK,
          payload: { text: 'check promo results' },
          runAt: new Date(Date.now() - 1_000),
          dedupeKey: 'promo-1',
        }),
        await scheduler.schedule(tx, {
          type: REMIND_TASK,
          payload: { text: 'later' },
          runAt: new Date(Date.now() + 86_400_000),
        }),
        await scheduler.schedule(tx, { type: 'e2e.unknown', payload: {}, runAt: new Date(0) }),
      ]),
    );
    const duplicate = await asAccount(cls, accountId, () =>
      accountDb.transaction((tx) =>
        scheduler.schedule(tx, {
          type: REMIND_TASK,
          payload: { text: 'dup' },
          runAt: new Date(),
          dedupeKey: 'promo-1',
        }),
      ),
    );
    expect(duplicate).toBeNull();

    expect(await moduleRef.get(ScheduledTasksSweeper).sweep()).toBe(2);

    const status = (id: string | null) =>
      systemDb.db
        .selectFrom('scheduled_tasks')
        .select(['status', 'last_error'])
        .where('id', '=', id as string)
        .executeTakeFirstOrThrow();

    await eventually(async () => {
      expect((await status(dueId)).status).toBe('succeeded');
      expect((await status(unknownId)).status).toBe('failed');
    });
    expect((await status(unknownId)).last_error).toMatch(/No handler/);
    expect((await status(futureId)).status).toBe('pending');
    expect(probe.reminders).toEqual([{ text: 'check promo results', accountId }]);
  });

  it('does not run a task cancelled before execution', async () => {
    const scheduler = moduleRef.get(ScheduledTasksService);
    const taskId = await asAccount(cls, accountId, () =>
      accountDb.transaction((tx) =>
        scheduler.schedule(tx, {
          type: REMIND_TASK,
          payload: { text: 'cancelled' },
          runAt: new Date(0),
        }),
      ),
    );
    await asAccount(cls, accountId, () =>
      accountDb.transaction((tx) => scheduler.cancel(tx, taskId as string)),
    );
    expect(await moduleRef.get(ScheduledTasksSweeper).sweep()).toBe(0);
    expect(probe.reminders.map((r) => r.text)).not.toContain('cancelled');
  });
});
