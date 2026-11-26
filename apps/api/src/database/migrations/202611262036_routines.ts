import { type Kysely, sql } from 'kysely';
import type { Migration } from 'kysely/migration';

import { IrreversibleMigrationError } from '../irreversible-migration.error.js';

export const routines: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      create table task_routines (
        tenant_id uuid not null,
        user_id uuid not null,
        id uuid not null,
        title text not null,
        description text not null,
        cadence text not null check (cadence in ('daily', 'weekly')),
        enabled boolean not null default true,
        next_run_at timestamptz not null,
        created_at timestamptz not null default now(),
        primary key (tenant_id, user_id, id),
        foreign key (tenant_id, user_id) references workspace_members(tenant_id, user_id)
      );

      create index task_routines_due on task_routines (next_run_at) where enabled;
      alter table task_routines enable row level security;
      alter table task_routines force row level security;
      create policy task_routines_scope on task_routines using (
        tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
      ) with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
      create policy task_routines_clock on task_routines for select using (
        current_user <> 'geniebox_app' and current_setting('app.routine_scan', true) = 'on'
      );

      create function due_task_routines()
        returns table (tenant_id uuid, user_id uuid, id uuid)
        language sql stable security definer
        set search_path = pg_catalog, public
        set app.routine_scan = 'on'
      as $$
        select r.tenant_id, r.user_id, r.id
          from public.task_routines r
          where r.enabled and r.next_run_at <= now()
          order by r.next_run_at, r.tenant_id, r.user_id, r.id
          limit 20
      $$;

      revoke all on function due_task_routines() from public;
      grant execute on function due_task_routines() to geniebox_app;
      grant select, insert, update (enabled, next_run_at) on task_routines to geniebox_app;
    `.execute(db);
  },

  async down() {
    throw new IrreversibleMigrationError('Routines migration stores task schedules.');
  },
};
