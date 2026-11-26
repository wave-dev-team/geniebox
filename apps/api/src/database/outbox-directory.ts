import { type Kysely, sql } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { DB } from './types.js';

@Injectable()
export class OutboxDirectory {
  constructor(private readonly db: Kysely<DB>) {}

  async due() {
    // Cross-tenant discovery is limited to identifiers by the database function.
    const result = await sql<{ tenant_id: string; id: string }>`
      select tenant_id, id from public.due_outbox_events()
    `.execute(this.db);
    return result.rows;
  }
}
