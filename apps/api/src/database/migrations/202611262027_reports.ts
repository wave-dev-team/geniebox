import { type Kysely, sql } from 'kysely';
import type { Migration } from 'kysely/migration';

import { IrreversibleMigrationError } from '../irreversible-migration.error.js';

export const reports: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      create table metrics_reports (
        tenant_id uuid not null,
        id uuid not null,
        created_by uuid not null,
        created_at timestamptz not null default now(),
        payload jsonb not null,
        primary key (tenant_id, id),
        foreign key (tenant_id, created_by) references workspace_members(tenant_id, user_id)
      );
      create index metrics_reports_history on metrics_reports (tenant_id, created_at desc, id desc);
      alter table metrics_reports enable row level security;
      alter table metrics_reports force row level security;
      create policy metrics_reports_scope on metrics_reports using (
        tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
      ) with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
      grant select, insert on metrics_reports to geniebox_app;
    `.execute(db);
  },

  async down() {
    throw new IrreversibleMigrationError('Reports migration stores historical metric comparisons.');
  },
};
