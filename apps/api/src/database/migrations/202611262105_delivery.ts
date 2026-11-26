import { type Kysely, sql } from 'kysely';
import type { Migration } from 'kysely/migration';

import { IrreversibleMigrationError } from '../irreversible-migration.error.js';

export const delivery: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      create table outbox_events (
        tenant_id uuid not null references workspaces(id),
        id uuid not null,
        type text not null check (type in ('chat.requested', 'task.requested')),
        payload jsonb not null,
        trace_id text not null,
        created_at timestamptz not null default now(),
        next_attempt_at timestamptz not null default now(),
        attempts integer not null default 0,
        published_at timestamptz,
        failed_at timestamptz,
        primary key (tenant_id, id)
      );
      create index outbox_pending on outbox_events (next_attempt_at, created_at, id)
        where published_at is null and failed_at is null;

      alter table chat_turns no force row level security;
      insert into outbox_events (tenant_id, id, type, payload, trace_id)
        select tenant_id, gen_random_uuid(), 'chat.requested',
          jsonb_build_object('tenantId', tenant_id, 'userId', user_id, 'turnId', id, 'traceId', trace_id), trace_id
        from chat_turns where status = 'pending';
      alter table chat_turns force row level security;
      alter table work_tasks no force row level security;
      insert into outbox_events (tenant_id, id, type, payload, trace_id)
        select tenant_id, gen_random_uuid(), 'task.requested',
          jsonb_build_object('tenantId', tenant_id, 'userId', user_id, 'taskId', id,
            'runId', run_id, 'traceId', trace_id), trace_id
        from work_tasks where status in ('planned', 'running') and run_id is not null;
      alter table work_tasks force row level security;

      alter table outbox_events enable row level security;
      alter table outbox_events force row level security;
      create policy outbox_scope on outbox_events using (
        tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
      ) with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
      create policy outbox_scan on outbox_events for select using (
        current_user <> 'geniebox_app' and current_setting('app.outbox_scan', true) = 'on'
      );
      create function due_outbox_events()
        returns table (tenant_id uuid, id uuid)
        language sql stable security definer
        set search_path = pg_catalog, public
        set app.outbox_scan = 'on'
      as $$
        select e.tenant_id, e.id from public.outbox_events e
        where e.published_at is null and e.failed_at is null and e.next_attempt_at <= now()
        order by e.next_attempt_at, e.created_at, e.id limit 24
      $$;
      revoke all on function due_outbox_events() from public;
      grant execute on function due_outbox_events() to geniebox_app;
      grant select, insert, update (attempts, next_attempt_at, published_at, failed_at) on outbox_events to geniebox_app;

      create table action_journal (
        tenant_id uuid not null references workspaces(id),
        id uuid not null,
        action text not null,
        actor_kind text not null check (actor_kind in ('user', 'agent', 'system')),
        actor_id uuid,
        actor_role text,
        target_id uuid not null,
        result text,
        details jsonb not null,
        trace_id text not null,
        created_at timestamptz not null default now(),
        primary key (tenant_id, id)
      );
      alter table action_journal enable row level security;
      alter table action_journal force row level security;
      create policy journal_insert on action_journal for insert with check (
        tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
      );
      grant insert on action_journal to geniebox_app;

      create function reject_journal_change() returns trigger
        language plpgsql set search_path = pg_catalog, public as $$
      begin
        raise exception 'Action journal is append-only' using errcode = '42501';
      end;
      $$;
      create trigger action_journal_immutable before update or delete or truncate on action_journal
        for each statement execute function reject_journal_change();
    `.execute(db);
  },

  async down() {
    throw new IrreversibleMigrationError('Delivery migration stores pending work and audit records.');
  },
};
