import { type Kysely, sql } from 'kysely';

// Shared by applied migrations: changing behaviour here rewrites history. Add new helpers instead.

/** Enables account RLS bound to `app.account_id`; FORCE applies it to the table owner as well. */
export async function enableAccountRls(
  db: Kysely<unknown>,
  table: string,
  column = 'account_id',
): Promise<void> {
  await sql`ALTER TABLE ${sql.table(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE ${sql.table(table)} FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`
    CREATE POLICY account_isolation ON ${sql.table(table)}
      USING (${sql.ref(column)} = app_current_account_id())
      WITH CHECK (${sql.ref(column)} = app_current_account_id())
  `.execute(db);
}

export async function forceRls(db: Kysely<unknown>, table: string): Promise<void> {
  await sql`ALTER TABLE ${sql.table(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE ${sql.table(table)} FORCE ROW LEVEL SECURITY`.execute(db);
}
