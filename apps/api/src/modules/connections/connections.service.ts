import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type MetricaConnectionInput, metricaConnectionSchema } from '@workspace/types';

import { homeActor, type WorkspaceActor } from '../../common/auth/request-actor.js';
import type { AppEnvironment } from '../../config/environment.js';
import { TenantDb } from '../../database/tenant-db.js';
import { AccountsRepository } from '../accounts/accounts.repository.js';
import { type MetricaPeriod, MetricaProvider } from './metrica.provider.js';

const provider = 'yandex-metrica';
const aad = (tenantId: string, counterId: string) =>
  Buffer.from(JSON.stringify([tenantId, provider, counterId]));

@Injectable()
export class ConnectionsService {
  private readonly key?: Buffer;

  constructor(
    config: ConfigService<AppEnvironment, true>,
    private readonly db: TenantDb,
    private readonly accounts: AccountsRepository,
    private readonly metrica: MetricaProvider,
  ) {
    const key = config.get('CONNECTIONS_ENCRYPTION_KEY', { infer: true });
    this.key = key ? Buffer.from(key, 'hex') : undefined;
  }

  async list() {
    const row = await this.db.transaction((tx) =>
      tx
        .selectFrom('connections')
        .select(['mode', 'counter_id', 'updated_at'])
        .where('provider', '=', provider)
        .executeTakeFirst(),
    );
    return {
      liveAvailable: Boolean(this.key),
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
      credential = this.encrypt(tenantId, input.counterId, input.token);
      counterId = input.counterId;
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      await this.metrica.totals(counterId, input.token, { from: yesterday, to: yesterday });
    }
    const values = { mode: input.mode, credential, counter_id: counterId, updated_at: new Date() };
    await this.db.transaction((tx) =>
      tx
        .insertInto('connections')
        .values({ tenant_id: tenantId, provider, ...values })
        .onConflict((constraint) => constraint.columns(['tenant_id', 'provider']).doUpdateSet(values))
        .execute(),
    );
  }

  async remove(actor: WorkspaceActor) {
    await this.authorize(actor);
    await this.db.transaction((tx) =>
      tx.deleteFrom('connections').where('provider', '=', provider).execute(),
    );
  }

  async totals(tenantId: string, period: MetricaPeriod) {
    const row = await this.db.transaction((tx) =>
      tx.selectFrom('connections').selectAll().where('provider', '=', provider).executeTakeFirst(),
    );
    if (!row) return undefined;
    if (row.mode === 'demo') {
      const days = Math.round((Date.parse(period.to) - Date.parse(period.from)) / 86_400_000) + 1;
      const offset = Math.floor(Date.parse(period.from) / 86_400_000) % 49;
      const visits = days * (204 + offset);
      return {
        mode: 'demo' as const,
        visits,
        users: Math.round(visits * 0.83),
        pageviews: visits * 3,
        sampled: false,
        url: null,
      };
    }
    if (!row.credential || !row.counter_id || row.tenant_id !== tenantId)
      throw new ServiceUnavailableException();
    const token = this.decrypt(tenantId, row.counter_id, row.credential);
    return { mode: 'live' as const, ...(await this.metrica.totals(row.counter_id, token, period)) };
  }

  private async authorize(actor: WorkspaceActor) {
    if ((await this.accounts.role(actor.tenantId, homeActor(actor))) !== 'owner')
      throw new ForbiddenException();
  }

  private encrypt(tenantId: string, counterId: string, token: string) {
    if (!this.key) throw new ServiceUnavailableException();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(aad(tenantId, counterId));
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  }

  private decrypt(tenantId: string, counterId: string, credential: string) {
    if (!this.key) throw new ServiceUnavailableException();
    try {
      const payload = Buffer.from(credential, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', this.key, payload.subarray(0, 12));
      decipher.setAAD(aad(tenantId, counterId));
      decipher.setAuthTag(payload.subarray(12, 28));
      return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
