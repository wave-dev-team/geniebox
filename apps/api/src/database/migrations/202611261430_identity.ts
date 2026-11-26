import { type Kysely, sql } from 'kysely';
import type { Migration } from 'kysely/migration';

import { IrreversibleMigrationError } from '../irreversible-migration.error.js';

export const identity: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable('user_profiles')
      .addColumn('tenant_id', 'uuid', (column) => column.notNull())
      .addColumn('id', 'uuid', (column) => column.notNull())
      .addColumn('email', 'text', (column) => column.notNull())
      .addColumn('name', 'text', (column) => column.notNull())
      .addColumn('password_hash', 'text')
      .addColumn('locale', 'text', (column) => column.notNull().defaultTo('ru'))
      .addColumn('timezone', 'text')
      .addColumn('email_verified_at', 'timestamptz')
      .addColumn('password_changed_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addPrimaryKeyConstraint('user_profiles_pk', ['tenant_id', 'id'])
      .execute();
    await sql`alter table user_profiles enable row level security`.execute(db);
    await sql`alter table user_profiles force row level security`.execute(db);
    await sql`create policy user_profiles_tenant on user_profiles
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)`.execute(db);
    await sql`grant select, insert, update on user_profiles to geniebox_app`.execute(db);

    // This global directory resolves an authenticated email identity to its tenant before request scope exists.
    await db.schema
      .createTable('email_identities')
      .addColumn('email_key', 'text', (column) => column.primaryKey())
      .addColumn('tenant_id', 'uuid', (column) => column.notNull())
      .addColumn('user_id', 'uuid', (column) => column.notNull())
      .addForeignKeyConstraint('email_identities_profile_fk', ['tenant_id', 'user_id'], 'user_profiles', [
        'tenant_id',
        'id',
      ])
      .execute();
    await sql`grant select, insert on email_identities to geniebox_app`.execute(db);
  },

  async down(): Promise<void> {
    // A rollback would erase sign-in identities and tenant-owned profile data.
    throw new IrreversibleMigrationError(
      'Identity migration cannot be rolled back without deleting user profiles.',
    );
  },
};
