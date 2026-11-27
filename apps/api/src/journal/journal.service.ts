import { Global, Injectable, Module } from '@nestjs/common';

import type { WriteContext } from '../database/write-context.js';
import type { JournalEntryInput } from './journal.types.js';

/**
 * Append-only action journal, written in the same transaction as the action itself.
 * The table rejects UPDATE/DELETE/TRUNCATE at the database level.
 */
@Injectable()
export class JournalService {
  async record(tx: WriteContext, entry: JournalEntryInput): Promise<void> {
    await tx.db
      .insertInto('action_journal')
      .values({
        account_id: tx.accountId ?? null,
        actor_type: entry.actor.type,
        actor_id: entry.actor.id,
        actor_role: entry.actor.role ?? null,
        action: entry.action,
        target_type: entry.target?.type ?? null,
        target_id: entry.target?.id ?? null,
        args: entry.args === undefined ? null : JSON.stringify(entry.args),
        result: entry.result === undefined ? null : JSON.stringify(entry.result),
        status: entry.status,
        trace_id: tx.traceId,
      })
      .execute();
  }
}

@Global()
@Module({
  providers: [JournalService],
  exports: [JournalService],
})
export class JournalModule {}
