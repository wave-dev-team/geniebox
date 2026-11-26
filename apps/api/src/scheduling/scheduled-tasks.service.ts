import { Injectable } from '@nestjs/common';

import type { AccountTx } from '../database/scoped-db.js';
import type { ScheduleTaskInput } from './scheduled-task.types.js';

@Injectable()
export class ScheduledTasksService {
  /** Persists the task in the caller's transaction. Returns null when deduplicated. */
  async schedule<TPayload>(tx: AccountTx, input: ScheduleTaskInput<TPayload>): Promise<string | null> {
    const row = await tx.db
      .insertInto('scheduled_tasks')
      .values({
        account_id: tx.accountId,
        type: input.type,
        payload: JSON.stringify(input.payload ?? {}),
        run_at: input.runAt,
        dedupe_key: input.dedupeKey ?? null,
        trace_id: tx.traceId,
      })
      .onConflict((oc) => oc.columns(['account_id', 'type', 'dedupe_key']).doNothing())
      .returning('id')
      .executeTakeFirst();
    return row?.id ?? null;
  }

  /** Cancels a task that has not finished yet. Returns false if it was already final. */
  async cancel(tx: AccountTx, taskId: string): Promise<boolean> {
    const result = await tx.db
      .updateTable('scheduled_tasks')
      .set({ status: 'cancelled' })
      .where('id', '=', taskId)
      .where('status', 'in', ['pending', 'enqueued'])
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }
}
