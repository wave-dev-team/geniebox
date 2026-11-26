import { type Kysely, sql } from 'kysely';
import type { Migration } from 'kysely/migration';

import { IrreversibleMigrationError } from '../irreversible-migration.error.js';

export const mailDelivery: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      alter table outbox_events drop constraint outbox_events_type_check,
        add constraint outbox_events_type_check
          check (type in ('chat.requested', 'task.requested', 'mail.requested'));

      -- The previous worker can still run during a rollout.
      create or replace function due_outbox_events()
        returns table (tenant_id uuid, id uuid)
        language sql stable security definer
        set search_path = pg_catalog, public
        set app.outbox_scan = 'on'
      as $$
        select e.tenant_id, e.id from public.outbox_events e
        where e.published_at is null and e.failed_at is null and e.next_attempt_at <= now()
          and e.type in ('chat.requested', 'task.requested')
        order by e.next_attempt_at, e.created_at, e.id limit 24
      $$;
      create function due_outbox_events(include_model boolean)
        returns table (tenant_id uuid, id uuid)
        language sql stable security definer
        set search_path = pg_catalog, public
        set app.outbox_scan = 'on'
      as $$
        select e.tenant_id, e.id from public.outbox_events e
        where e.published_at is null and e.failed_at is null and e.next_attempt_at <= now()
          and (include_model or e.type = 'mail.requested')
        order by e.next_attempt_at, e.created_at, e.id limit 24
      $$;
      revoke all on function due_outbox_events(boolean) from public;
      grant execute on function due_outbox_events(boolean) to geniebox_app;
    `.execute(db);
  },

  async down() {
    throw new IrreversibleMigrationError('Mail delivery migration may contain pending invitations.');
  },
};
