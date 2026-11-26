import { type Kysely, sql } from 'kysely';
import type { Migration } from 'kysely/migration';

import { IrreversibleMigrationError } from '../irreversible-migration.error.js';

export const accounts: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      create table workspaces (
        id uuid primary key,
        name text not null default 'Geniebox' check (length(name) between 1 and 120),
        created_at timestamptz not null default now()
      );

      create table workspace_members (
        tenant_id uuid not null references workspaces(id),
        user_id uuid not null,
        home_tenant_id uuid not null,
        role text not null check (role in ('owner', 'member')),
        created_at timestamptz not null default now(),
        primary key (tenant_id, user_id),
        foreign key (home_tenant_id, user_id) references user_profiles(tenant_id, id)
      );
      create index workspace_members_identity on workspace_members (home_tenant_id, user_id);

      alter table user_profiles no force row level security;
      insert into workspaces (id) select distinct tenant_id from user_profiles;
      insert into workspace_members (tenant_id, user_id, home_tenant_id, role)
        select tenant_id, id, tenant_id, 'owner' from user_profiles;
      alter table user_profiles force row level security;

      alter table chat_turns drop constraint chat_turns_tenant_id_user_id_fkey,
        add foreign key (tenant_id, user_id) references workspace_members(tenant_id, user_id);
      alter table agents drop constraint agents_tenant_id_user_id_fkey,
        add foreign key (tenant_id, user_id) references workspace_members(tenant_id, user_id);
      alter table work_tasks drop constraint work_tasks_tenant_id_user_id_fkey,
        add foreign key (tenant_id, user_id) references workspace_members(tenant_id, user_id);

      alter table workspaces enable row level security;
      alter table workspaces force row level security;
      alter table workspace_members enable row level security;
      alter table workspace_members force row level security;

      create policy workspace_scope on workspaces using (
        id = nullif(current_setting('app.tenant_id', true), '')::uuid
      ) with check (id = nullif(current_setting('app.tenant_id', true), '')::uuid);
      create policy member_scope on workspace_members using (
        tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
      ) with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
      create policy member_directory on workspace_members for select using (
        (home_tenant_id, user_id) = (
          nullif(current_setting('app.identity_tenant_id', true), '')::uuid,
          nullif(current_setting('app.identity_user_id', true), '')::uuid
        )
      );
      create policy workspace_directory on workspaces for select using (
        exists (select 1 from workspace_members where tenant_id = workspaces.id)
      );
      create table workspace_invitations (
        tenant_id uuid not null references workspaces(id),
        token_hash text not null primary key,
        email text not null,
        expires_at timestamptz not null,
        accepted_at timestamptz
      );
      alter table workspace_invitations enable row level security;
      alter table workspace_invitations force row level security;
      create policy invitation_scope on workspace_invitations using (
        tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
      ) with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
      create policy invitation_lookup on workspace_invitations for select using (
        token_hash = current_setting('app.invite_hash', true)
      );
      grant select, insert, update (accepted_at), delete on workspace_invitations to geniebox_app;
      grant select, insert, update (name) on workspaces to geniebox_app;
      grant select, insert on workspace_members to geniebox_app;

      create function provision_home_workspace() returns trigger
      language plpgsql set search_path = pg_catalog, public as $$
      begin
        insert into public.workspaces (id) values (new.tenant_id) on conflict (id) do nothing;
        insert into public.workspace_members (tenant_id, user_id, home_tenant_id, role)
          values (new.tenant_id, new.id, new.tenant_id, 'owner');
        return new;
      end;
      $$;

      create trigger provision_home_workspace after insert on user_profiles
        for each row execute function provision_home_workspace();
    `.execute(db);
  },

  async down() {
    throw new IrreversibleMigrationError('Accounts migration stores workspace memberships.');
  },
};
