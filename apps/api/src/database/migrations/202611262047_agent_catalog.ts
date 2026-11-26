import { type Kysely, sql } from 'kysely';
import type { Migration } from 'kysely/migration';

import { IrreversibleMigrationError } from '../irreversible-migration.error.js';

export const agentCatalog: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      alter table agents
        add column catalog_key text check (catalog_key in ('metrics', 'hypotheses', 'research')),
        add column revision integer not null default 1 check (revision > 0),
        add unique (tenant_id, user_id, catalog_key);

      create table agent_versions (
        tenant_id uuid not null,
        user_id uuid not null,
        agent_id uuid not null,
        revision integer not null,
        name text not null,
        instructions text not null,
        created_at timestamptz not null default now(),
        primary key (tenant_id, user_id, agent_id, revision),
        foreign key (tenant_id, user_id, agent_id) references agents(tenant_id, user_id, id)
      );

      alter table agents no force row level security;
      insert into agent_versions (tenant_id, user_id, agent_id, revision, name, instructions)
        select tenant_id, user_id, id, revision, name, instructions from agents;
      alter table agents force row level security;

      alter table agent_versions enable row level security;
      alter table agent_versions force row level security;
      create policy agent_versions_scope on agent_versions using (
        tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
      ) with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
      grant select, insert on agent_versions to geniebox_app;

      create function set_agent_revision() returns trigger
        language plpgsql set search_path = pg_catalog, public as $$
      begin
        if (new.name, new.instructions) is distinct from (old.name, old.instructions) then
          new.revision := old.revision + 1;
        else
          new.revision := old.revision;
        end if;
        return new;
      end;
      $$;

      create function store_agent_revision() returns trigger
        language plpgsql set search_path = pg_catalog, public as $$
      begin
        if tg_op = 'INSERT' or new.revision <> old.revision then
          insert into public.agent_versions (tenant_id, user_id, agent_id, revision, name, instructions)
            values (new.tenant_id, new.user_id, new.id, new.revision, new.name, new.instructions);
        end if;
        return new;
      end;
      $$;

      create trigger agent_revision_before_update before update on agents
        for each row execute function set_agent_revision();
      create trigger agent_revision_after_write after insert or update on agents
        for each row execute function store_agent_revision();
    `.execute(db);
  },

  async down() {
    throw new IrreversibleMigrationError('Agent catalog migration stores instruction history.');
  },
};
