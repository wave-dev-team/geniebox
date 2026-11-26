import { Injectable } from '@nestjs/common';

import type { WriteContext } from '../database/write-context.js';
import type { OutboxEventInput } from './outbox.types.js';

/**
 * Writes events in the caller's transaction: the event exists iff the business change
 * committed. The relay delivers them afterwards.
 */
@Injectable()
export class OutboxService {
  async add<TPayload>(tx: WriteContext, event: OutboxEventInput<TPayload>): Promise<void> {
    await tx.db
      .insertInto('outbox_events')
      .values({
        account_id: tx.accountId ?? null,
        type: event.type,
        payload: JSON.stringify(event.payload ?? null),
        trace_id: tx.traceId,
      })
      .execute();
  }
}
