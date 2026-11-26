import { type Kysely, sql } from 'kysely';

import { Inject, Injectable } from '@nestjs/common';

import { APP_KYSELY, SYSTEM_KYSELY } from './database.tokens.js';
import type { DB } from './types.js';

/** Connectivity probe for health checks; exposes no data access. */
@Injectable()
export class DatabasePing {
  constructor(
    @Inject(APP_KYSELY) private readonly app: Kysely<DB>,
    @Inject(SYSTEM_KYSELY) private readonly system: Kysely<DB>,
  ) {}

  async pingApp(): Promise<void> {
    await sql`SELECT 1`.execute(this.app);
  }

  async pingSystem(): Promise<void> {
    await sql`SELECT 1`.execute(this.system);
  }
}
