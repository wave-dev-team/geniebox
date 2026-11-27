import { type Kysely, sql } from 'kysely';

import { DB_ROLES } from '../roles.js';
import type { DB } from '../types.js';

export async function up(db: Kysely<DB>): Promise<void> {
  await sql`
    CREATE POLICY support_mail_outbox ON outbox_events FOR INSERT TO ${sql.id(DB_ROLES.app)}
    WITH CHECK (
      account_id IS NULL AND type = 'support.requested' AND EXISTS (
        SELECT FROM support_requests
        WHERE id::text = payload->>'requestId' AND user_id = app_current_user_id()
      )
    )
  `.execute(db);
}

export async function down(db: Kysely<DB>): Promise<void> {
  await sql`DROP POLICY support_mail_outbox ON outbox_events`.execute(db);
}
