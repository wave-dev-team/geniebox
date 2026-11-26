import { randomUUID } from 'node:crypto';

import type { Transaction } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { DB } from '../database/types.js';
import { type OutboxEvent, outboxEventSchema } from './outbox.types.js';

@Injectable()
export class OutboxService {
  async enqueue(tx: Transaction<DB>, input: OutboxEvent) {
    const { payload, type } = outboxEventSchema.parse(input);
    await tx
      .insertInto('outbox_events')
      .values({
        id: randomUUID(),
        tenant_id: payload.tenantId,
        trace_id: payload.traceId,
        payload,
        type,
      })
      .execute();
  }
}
