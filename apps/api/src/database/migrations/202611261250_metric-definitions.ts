import { type Kysely, sql } from 'kysely';
import type { Migration } from 'kysely/migration';

export const metricDefinitions: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable('metric_definitions')
      .addColumn('tenant_id', 'uuid', (column) => column.notNull())
      .addColumn('key', 'text', (column) => column.notNull())
      .addColumn('label', 'text', (column) => column.notNull())
      .addPrimaryKeyConstraint('metric_definitions_pk', ['tenant_id', 'key'])
      .execute();

    await sql`alter table metric_definitions enable row level security`.execute(db);
    await sql`alter table metric_definitions force row level security`.execute(db);
    await sql`create policy metric_definitions_tenant on metric_definitions
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)`.execute(db);
    await sql`grant select, insert, update, delete on metric_definitions to geniebox_app`.execute(db);
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('metric_definitions').execute();
  },
};
