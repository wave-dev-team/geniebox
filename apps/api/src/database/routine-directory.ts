import { type Kysely, sql } from 'kysely';

import { Injectable } from '@nestjs/common';

import type { DB } from './types.js';

@Injectable()
export class RoutineDirectory {
  constructor(private readonly db: Kysely<DB>) {}

  async due() {
    // The clock only discovers bounded batches of identifiers. Task data is read in tenant scope.
    const result = await sql<{ tenant_id: string; user_id: string; id: string }>`
      select tenant_id, user_id, id from due_task_routines()
    `.execute(this.db);
    return result.rows;
  }
}
