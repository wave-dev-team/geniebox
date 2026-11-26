import { randomUUID } from 'node:crypto';

import type { Transaction } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { DB } from '../database/types.js';

interface JournalEntry {
  tenantId: string;
  traceId: string;
  action: string;
  targetId: string;
  actor: { kind: 'user' | 'agent' | 'system'; id?: string; role?: string };
  result?: string;
  details?: Record<string, string | number | boolean | null>;
}

@Injectable()
export class JournalService {
  async append(tx: Transaction<DB>, entry: JournalEntry) {
    await tx
      .insertInto('action_journal')
      .values({
        action: entry.action,
        actor_id: entry.actor.id ?? null,
        actor_kind: entry.actor.kind,
        actor_role: entry.actor.role ?? null,
        details: entry.details ?? {},
        id: randomUUID(),
        result: entry.result ?? null,
        target_id: entry.targetId,
        tenant_id: entry.tenantId,
        trace_id: entry.traceId,
      })
      .execute();
  }
}
