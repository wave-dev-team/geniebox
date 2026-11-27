import { type Kysely, sql } from 'kysely';

import { DB_ROLES } from '../roles.js';
import type { DB } from '../types.js';

export async function up(db: Kysely<DB>): Promise<void> {
  await sql`ALTER TABLE accounts ADD COLUMN manager_context_reset_at timestamptz`.execute(db);
  await sql`ALTER TABLE account_members ADD COLUMN manager_context_reset_at timestamptz`.execute(db);
  await sql`GRANT UPDATE (manager_context_reset_at) ON accounts TO ${sql.id(DB_ROLES.app)}`.execute(db);
  await sql`GRANT UPDATE (manager_context_reset_at) ON account_members TO ${sql.id(DB_ROLES.app)}`.execute(
    db,
  );
}

export async function down(db: Kysely<DB>): Promise<void> {
  await sql`ALTER TABLE account_members DROP COLUMN manager_context_reset_at`.execute(db);
  await sql`ALTER TABLE accounts DROP COLUMN manager_context_reset_at`.execute(db);
}
