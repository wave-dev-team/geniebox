import { ForbiddenException, Injectable } from '@nestjs/common';

import { type MetricKey, metricKeys } from '@workspace/types';

import { homeActor, type WorkspaceActor } from '../../common/auth/request-actor.js';
import { TenantDb } from '../../database/tenant-db.js';
import { AccountsRepository } from '../accounts/accounts.repository.js';

@Injectable()
export class MetricsService {
  constructor(
    private readonly db: TenantDb,
    private readonly accounts: AccountsRepository,
  ) {}

  async list() {
    const rows = await this.db.transaction((tx) =>
      tx.selectFrom('metric_definitions').select(['key', 'label']).execute(),
    );
    const labels = new Map(rows.map(({ key, label }) => [key, label]));
    return metricKeys.map((key) => ({ key, label: labels.get(key) ?? key }));
  }

  async rename(actor: WorkspaceActor, key: MetricKey, label: string) {
    if ((await this.accounts.role(actor.tenantId, homeActor(actor))) !== 'owner')
      throw new ForbiddenException();
    await this.db.transaction((tx) =>
      tx
        .insertInto('metric_definitions')
        .values({ tenant_id: actor.tenantId, key, label })
        .onConflict((index) => index.columns(['tenant_id', 'key']).doUpdateSet({ label }))
        .execute(),
    );
  }
}
