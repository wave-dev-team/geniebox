import { type Kysely, sql } from 'kysely';
import type { Migration } from 'kysely/migration';

import { IrreversibleMigrationError } from '../irreversible-migration.error.js';

export const managerChat: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      create table chat_turns (
        tenant_id uuid not null,
        user_id uuid not null,
        id uuid not null,
        message text not null,
        answer text,
        status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'limited')),
        created_at timestamptz not null default clock_timestamp(),
        trace_id text not null,
        primary key (tenant_id, user_id, id),
        foreign key (tenant_id, user_id) references user_profiles(tenant_id, id)
      );
      create unique index chat_turns_pending on chat_turns (tenant_id, user_id) where status = 'pending';
      create index chat_turns_history on chat_turns (tenant_id, user_id, created_at desc, id desc);
      alter table chat_turns enable row level security;
      alter table chat_turns force row level security;
      create policy chat_turns_tenant on chat_turns
        using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
        with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
      grant select, insert, update on chat_turns to geniebox_app;

      create table llm_calls (
        tenant_id uuid not null,
        id uuid not null,
        user_id uuid not null,
        turn_id uuid not null,
        role text not null,
        model text not null,
        prompt_version text not null,
        trace_id text not null,
        created_at timestamptz not null default clock_timestamp(),
        result text not null default 'started',
        tokens_in integer,
        tokens_out integer,
        cost_usd numeric(14, 8),
        latency_ms integer,
        primary key (tenant_id, id),
        foreign key (tenant_id, user_id, turn_id) references chat_turns(tenant_id, user_id, id)
      );
      create index llm_calls_daily on llm_calls (tenant_id, role, created_at);
      alter table llm_calls enable row level security;
      alter table llm_calls force row level security;
      create policy llm_calls_tenant on llm_calls
        using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
        with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
      grant select, insert, update on llm_calls to geniebox_app;
    `.execute(db);
  },
  async down() {
    throw new IrreversibleMigrationError('Removing the chat migration would erase conversation history.');
  },
};
