import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import type { DB } from './types.js';

export function createDb(connectionString: string): Kysely<DB> {
  return new Kysely({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString, connectionTimeoutMillis: 5000 }) }),
  });
}
