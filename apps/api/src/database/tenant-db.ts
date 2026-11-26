import { type Kysely, sql, type Transaction } from 'kysely';
import { z } from 'zod';

import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ClsService, type ClsStore } from 'nestjs-cls';

import type { DB } from './types.js';

export interface RequestContext extends ClsStore {
  tenantId: string;
}

@Injectable()
export class TenantDb implements OnApplicationShutdown {
  constructor(
    private readonly db: Kysely<DB>,
    private readonly context: ClsService<RequestContext>,
  ) {}

  /** Runs a database operation with isolated tenant context for the lifetime of its transaction. */
  async transaction<T>(operation: (transaction: Transaction<DB>) => Promise<T>): Promise<T> {
    const tenantId = z.uuid().parse(this.context.get('tenantId'));

    return this.db.transaction().execute(async (transaction) => {
      await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(transaction);
      return operation(transaction);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
