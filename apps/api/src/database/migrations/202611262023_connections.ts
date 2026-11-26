import { type Kysely, sql } from 'kysely';
import type { Migration } from 'kysely/migration';

import { IrreversibleMigrationError } from '../irreversible-migration.error.js';

export const connections: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      create table connections (
        tenant_id uuid not null references workspaces(id),
        provider text not null check (provider = 'yandex-metrica'),
        mode text not null check (mode in ('live', 'demo')),
        counter_id text,
        credential text,
        updated_at timestamptz not null default now(),
        primary key (tenant_id, provider),
        check ((mode = 'demo' and counter_id is null and credential is null)
          or (mode = 'live' and counter_id is not null and credential is not null))
      );
      alter table connections enable row level security;
      alter table connections force row level security;
      create policy connections_scope on connections using (
        tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
      ) with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
      grant select, insert, update, delete on connections to geniebox_app;
    `.execute(db);
  },

  async down() {
    throw new IrreversibleMigrationError('Connections migration stores configured credentials.');
  },
};
