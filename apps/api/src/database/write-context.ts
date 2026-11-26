import type { Transaction } from 'kysely';

import type { DB } from './types.js';

/**
 * Minimal transaction context for writers that must join the caller's transaction
 * (outbox, journal). AccountTx satisfies it; system flows build it explicitly.
 * `accountId: null` marks platform-level records and is only writable by the system role.
 */
export interface WriteContext {
  readonly db: Transaction<DB>;
  readonly accountId: string | null | undefined;
  readonly traceId: string;
}
