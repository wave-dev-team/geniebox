import { type Kysely, sql } from 'kysely';

import type { DB } from './types.js';

export class DatabasePing {
  constructor(private readonly db: Kysely<DB>) {}

  async check() {
    await sql`select 1`.execute(this.db);
  }
}
