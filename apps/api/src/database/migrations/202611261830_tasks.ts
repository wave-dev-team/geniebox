import { type Kysely, sql } from 'kysely';
import type { Migration } from 'kysely/migration';

import { IrreversibleMigrationError } from '../irreversible-migration.error.js';

export const tasks: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      alter table agent_tasks
        add column id uuid not null default gen_random_uuid(),
        add column created_at timestamptz not null default clock_timestamp(),
        add column updated_at timestamptz not null default clock_timestamp(),
        add unique (tenant_id, user_id, id);
      update agent_tasks as item
        set created_at = turn.created_at, updated_at = turn.created_at
        from chat_turns as turn
        where (item.tenant_id, item.user_id, item.turn_id) = (turn.tenant_id, turn.user_id, turn.id);
      create index agent_tasks_activity on agent_tasks (tenant_id, user_id, created_at desc, id desc);

      create table work_tasks (
        tenant_id uuid not null,
        user_id uuid not null,
        id uuid not null,
        title text not null,
        description text not null default '',
        due_on date,
        agent_id uuid,
        agent_name text,
        status text not null default 'planned' check (status in ('planned', 'running', 'failed', 'done', 'cancelled')),
        result text,
        run_id uuid,
        trace_id text not null,
        created_at timestamptz not null default clock_timestamp(),
        updated_at timestamptz not null default clock_timestamp(),
        primary key (tenant_id, user_id, id),
        foreign key (tenant_id, user_id) references user_profiles(tenant_id, id),
        foreign key (tenant_id, user_id, agent_id) references agents(tenant_id, user_id, id),
        check ((agent_id is null and agent_name is null and run_id is null)
          or (agent_id is not null and agent_name is not null and run_id is not null))
      );
      create index work_tasks_activity on work_tasks (tenant_id, user_id, created_at desc, id desc);
      alter table work_tasks enable row level security;
      alter table work_tasks force row level security;
      create policy work_tasks_tenant on work_tasks
        using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
        with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
      grant select, insert, update on work_tasks to geniebox_app;

      alter table llm_calls
        alter column turn_id drop not null,
        add column work_task_id uuid,
        add foreign key (tenant_id, user_id, work_task_id) references work_tasks(tenant_id, user_id, id),
        add check (num_nonnulls(turn_id, work_task_id) = 1);
    `.execute(db);
  },
  async down() {
    throw new IrreversibleMigrationError('Removing tasks would erase work history.');
  },
};
