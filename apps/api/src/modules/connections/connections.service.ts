import { randomUUID } from 'node:crypto';

import { ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import { type MetricaConnectionInput, metricaConnectionSchema } from '@workspace/types';

import { homeActor, type WorkspaceActor } from '../../common/auth/request-actor.js';
import { TenantDb } from '../../database/tenant-db.js';
import { JournalService } from '../../journal/journal.service.js';
import { SecretCipher } from '../../secrets/secret-cipher.js';
import { AccountsRepository } from '../accounts/accounts.repository.js';
import { type MetricaPeriod, MetricaProvider } from './metrica.provider.js';

const provider = 'yandex-metrica';
@Injectable()
export class ConnectionsService {
  constructor(
    private readonly cipher: SecretCipher,
    private readonly db: TenantDb,
    private readonly accounts: AccountsRepository,
    private readonly metrica: MetricaProvider,
    private readonly journal: JournalService,
    private readonly context: ClsService,
  ) {}

  async list() {
    const row = await this.db.transaction((tx) =>
      tx
        .selectFrom('connections')
        .select(['mode', 'counter_id', 'updated_at'])
        .where('provider', '=', provider)
        .executeTakeFirst(),
    );
    return {
      liveAvailable: this.cipher.available,
      metrica: row
        ? metricaConnectionSchema.parse({
            mode: row.mode,
            counterId: row.counter_id,
            checkedAt: row.updated_at.toISOString(),
          })
        : null,
    };
  }

  async save(actor: WorkspaceActor, input: MetricaConnectionInput) {
    await this.authorize(actor);
    const { tenantId } = actor;
    let credential: string | null = null;
    let counterId: string | null = null;
    if (input.mode === 'live') {
      credential = this.cipher.seal([tenantId, provider, input.counterId], input.token);
      counterId = input.counterId;
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      await this.metrica.totals(counterId, input.token, { from: yesterday, to: yesterday });
    }
    const values = { mode: input.mode, credential, counter_id: counterId, updated_at: new Date() };
    await this.db.transaction(async (tx) => {
      await tx
        .insertInto('connections')
        .values({ tenant_id: tenantId, provider, ...values })
        .onConflict((constraint) => constraint.columns(['tenant_id', 'provider']).doUpdateSet(values))
        .execute();
      await this.journal.append(tx, {
        tenantId,
        traceId: this.context.getId() ?? randomUUID(),
        targetId: tenantId,
        actor: { kind: 'user', id: actor.userId, role: 'owner' },
        action: 'connection.saved',
        details: { provider, mode: input.mode },
      });
    });
  }

  async remove(actor: WorkspaceActor) {
    await this.authorize(actor);
    await this.db.transaction(async (tx) => {
      const deleted = await tx
        .deleteFrom('connections')
        .where('provider', '=', provider)
        .returning('tenant_id')
        .executeTakeFirst();
      if (!deleted) return;
      await this.journal.append(tx, {
        tenantId: actor.tenantId,
        traceId: this.context.getId() ?? randomUUID(),
        targetId: actor.tenantId,
        actor: { kind: 'user', id: actor.userId, role: 'owner' },
        action: 'connection.removed',
        details: { provider },
      });
    });
  }

  async compare(tenantId: string, baseline: MetricaPeriod, comparison: MetricaPeriod) {
    const row = await this.db.transaction((tx) =>
      tx.selectFrom('connections').selectAll().where('provider', '=', provider).executeTakeFirst(),
    );
    if (!row) return undefined;
    if (row.mode === 'demo') {
      return {
        mode: 'demo' as const,
        before: this.demo(baseline),
        after: this.demo(comparison),
        sampled: false,
        url: null,
      };
    }
    if (!row.credential || !row.counter_id || row.tenant_id !== tenantId) {
      throw new ServiceUnavailableException();
    }
    const token = this.cipher.open([tenantId, provider, row.counter_id], row.credential);
    const before = await this.metrica.totals(row.counter_id, token, baseline);
    const after = await this.metrica.totals(row.counter_id, token, comparison);
    return {
      mode: 'live' as const,
      before,
      after,
      sampled: before.sampled || after.sampled,
      url: after.url,
    };
  }

  private demo(period: MetricaPeriod) {
    const day = 86_400_000;
    const first = Date.parse(period.from) / day;
    const last = Date.parse(period.to) / day;
    let visits = 0;
    for (let date = first; date <= last; date++) {
      visits += 204 + (((date % 49) + 49) % 49);
    }
    return { visits, users: Math.round(visits * 0.83), pageviews: visits * 3 };
  }

  private async authorize(actor: WorkspaceActor) {
    if ((await this.accounts.role(actor.tenantId, homeActor(actor))) !== 'owner')
      throw new ForbiddenException();
  }
}
