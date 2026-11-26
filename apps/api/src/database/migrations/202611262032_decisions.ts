import { type Kysely, sql } from 'kysely';
import type { Migration } from 'kysely/migration';

import { IrreversibleMigrationError } from '../irreversible-migration.error.js';

export const decisions: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      create table report_decisions (
        tenant_id uuid not null,
        report_id uuid not null,
        decided_by uuid not null,
        outcome text not null check (outcome in ('followUp', 'close')),
        rationale text not null,
        task_id uuid,
        created_at timestamptz not null default now(),
        primary key (tenant_id, report_id),
        foreign key (tenant_id, report_id) references metrics_reports(tenant_id, id),
        foreign key (tenant_id, decided_by) references workspace_members(tenant_id, user_id),
        foreign key (tenant_id, decided_by, task_id) references work_tasks(tenant_id, user_id, id),
        check ((outcome = 'followUp') = (task_id is not null))
      );
      alter table report_decisions enable row level security;
      alter table report_decisions force row level security;
      create policy report_decisions_scope on report_decisions using (
        tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
      ) with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
      grant select, insert on report_decisions to geniebox_app;
    `.execute(db);
  },

  async down() {
    throw new IrreversibleMigrationError('Decisions migration stores workspace decisions linked to tasks.');
  },
};
