import type { Kysely, Transaction } from 'kysely';

import { Inject, Injectable } from '@nestjs/common';

import { SYSTEM_KYSELY } from './database.tokens.js';
import type { DB } from './types.js';

/**
 * Cross-account access on the BYPASSRLS system role. Allowed only in platform-level jobs
 * (outbox relay, sweepers, account provisioning); every injection site explains why.
 */
@Injectable()
export class SystemDb {
  constructor(@Inject(SYSTEM_KYSELY) readonly db: Kysely<DB>) {}

  transaction<T>(work: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(work);
  }
}
