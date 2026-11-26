import { type Kysely, sql } from 'kysely';

import type { DB } from './types.js';

export async function bootstrapRoles(db: Kysely<DB>, password: string): Promise<void> {
  await db.transaction().execute(async (transaction) => {
    await sql`select set_config('geniebox.bootstrap_password', ${password}, true)`.execute(transaction);
    await sql`do $bootstrap$
      begin
        if not exists (select from pg_roles where rolname = 'geniebox_app') then
          create role geniebox_app;
        end if;
        execute format(
          'alter role geniebox_app with login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password %L',
          current_setting('geniebox.bootstrap_password')
        );
      end
    $bootstrap$`.execute(transaction);
    await sql`grant usage on schema public to geniebox_app`.execute(transaction);
  });
}
