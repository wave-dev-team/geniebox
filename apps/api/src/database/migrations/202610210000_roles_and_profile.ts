import { type Kysely, sql } from 'kysely';

import { DB_ROLES } from '../roles.js';

const { app } = DB_ROLES;

/**
 * Member roles: `member` splits into `tech` (connections, keys,
 * agent permissions; no money, no decisions) and `viewer` (read-only). Existing members keep
 * their previous capabilities as `tech`. Adds the profile fields the UI needs: personal time
 * zone and the time of the last password change.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE account_members DROP CONSTRAINT account_members_role_check`.execute(db);
  await sql`UPDATE account_members SET role = 'tech' WHERE role = 'member'`.execute(db);
  await sql`
    ALTER TABLE account_members ADD CONSTRAINT account_members_role_check
      CHECK (role IN ('owner', 'admin', 'tech', 'viewer'))
  `.execute(db);

  await sql`ALTER TABLE account_invitations DROP CONSTRAINT account_invitations_role_check`.execute(db);
  await sql`UPDATE account_invitations SET role = 'tech' WHERE role = 'member'`.execute(db);
  await sql`
    ALTER TABLE account_invitations ADD CONSTRAINT account_invitations_role_check
      CHECK (role IN ('admin', 'tech', 'viewer'))
  `.execute(db);

  // NULL time zone means "same as the project" in the UI.
  await sql`
    ALTER TABLE users
      ADD COLUMN timezone text CHECK (length(timezone) BETWEEN 1 AND 64),
      ADD COLUMN password_changed_at timestamptz
  `.execute(db);
  await sql`
    UPDATE users SET password_changed_at = updated_at WHERE password_hash IS NOT NULL
  `.execute(db);
  await sql`GRANT SELECT (timezone, password_changed_at) ON users TO ${sql.id(app)}`.execute(db);
  await sql`GRANT UPDATE (timezone) ON users TO ${sql.id(app)}`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`REVOKE UPDATE (timezone) ON users FROM ${sql.id(app)}`.execute(db);
  await sql`REVOKE SELECT (timezone, password_changed_at) ON users FROM ${sql.id(app)}`.execute(db);
  await sql`ALTER TABLE users DROP COLUMN password_changed_at, DROP COLUMN timezone`.execute(db);

  await sql`ALTER TABLE account_invitations DROP CONSTRAINT account_invitations_role_check`.execute(db);
  await sql`UPDATE account_invitations SET role = 'member' WHERE role IN ('tech', 'viewer')`.execute(db);
  await sql`
    ALTER TABLE account_invitations ADD CONSTRAINT account_invitations_role_check
      CHECK (role IN ('admin', 'member'))
  `.execute(db);

  await sql`ALTER TABLE account_members DROP CONSTRAINT account_members_role_check`.execute(db);
  await sql`UPDATE account_members SET role = 'member' WHERE role IN ('tech', 'viewer')`.execute(db);
  await sql`
    ALTER TABLE account_members ADD CONSTRAINT account_members_role_check
      CHECK (role IN ('owner', 'admin', 'member'))
  `.execute(db);
}
