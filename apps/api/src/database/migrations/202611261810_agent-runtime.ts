import { type Kysely, sql } from 'kysely';
import type { Migration } from 'kysely/migration';

import { IrreversibleMigrationError } from '../irreversible-migration.error.js';

export const agentRuntime: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      create table agents (
        tenant_id uuid not null,
        user_id uuid not null,
        id uuid not null,
        name text not null,
        instructions text not null,
        enabled boolean not null default false,
        primary key (tenant_id, user_id, id),
        foreign key (tenant_id, user_id) references user_profiles(tenant_id, id)
      );
      alter table agents enable row level security;
      alter table agents force row level security;
      create policy agents_tenant on agents
        using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
        with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
      grant select, insert, update on agents to geniebox_app;

      alter table chat_turns add column planned boolean not null default false;

      create table agent_tasks (
        tenant_id uuid not null,
        user_id uuid not null,
        turn_id uuid not null,
        agent_id uuid not null,
        agent_name text not null,
        position integer not null,
        status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
        result text,
        primary key (tenant_id, user_id, turn_id, agent_id),
        unique (tenant_id, user_id, turn_id, position),
        foreign key (tenant_id, user_id, turn_id) references chat_turns(tenant_id, user_id, id),
        foreign key (tenant_id, user_id, agent_id) references agents(tenant_id, user_id, id)
      );
      alter table agent_tasks enable row level security;
      alter table agent_tasks force row level security;
      create policy agent_tasks_tenant on agent_tasks
        using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
        with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
      grant select, insert, update on agent_tasks to geniebox_app;
    `.execute(db);
  },
  async down() {
    throw new IrreversibleMigrationError('Removing the runtime would erase agents and their task results.');
  },
};
