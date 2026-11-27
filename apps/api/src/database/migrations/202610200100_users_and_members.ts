import { type Kysely, sql } from 'kysely';

import { DB_ROLES } from '../roles.js';
import { enableAccountRls, forceRls } from './helpers.js';

const { app, system } = DB_ROLES;

export async function up(db: Kysely<unknown>): Promise<void> {
  // users: global identities, not owned by an account. Auth flows run on the system role;
  // the app role sees itself and members of the current account, never password hashes.
  await sql`
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      -- Stored normalized (trimmed, lower-case); uniqueness is exact on that form.
      email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND length(email) <= 254),
      email_verified_at timestamptz,
      password_hash text,
      display_name text CHECK (length(display_name) <= 100),
      locale text NOT NULL DEFAULT 'ru' CHECK (locale IN ('ru', 'en')),
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
      blocked_at timestamptz,
      blocked_reason text CHECK (length(blocked_reason) <= 500),
      -- Sign-in and token refresh; used for security diagnostics.
      last_seen_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE TRIGGER users_touch BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at()
  `.execute(db);

  await sql`
    CREATE TABLE user_identities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      provider text NOT NULL CHECK (provider IN ('google', 'apple')),
      subject text NOT NULL,
      email text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (provider, subject),
      UNIQUE (user_id, provider)
    )
  `.execute(db);

  await sql`
    CREATE TABLE account_members (
      account_id uuid NOT NULL REFERENCES accounts (id),
      user_id uuid NOT NULL REFERENCES users (id),
      role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (account_id, user_id)
    )
  `.execute(db);
  await sql`CREATE INDEX account_members_user_idx ON account_members (user_id)`.execute(db);
  // Exactly one owner per account: at most one by index, at least one by the trigger below.
  await sql`
    CREATE UNIQUE INDEX account_members_single_owner_idx ON account_members (account_id)
      WHERE role = 'owner'
  `.execute(db);
  await sql`
    CREATE TRIGGER account_members_touch BEFORE UPDATE ON account_members
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at()
  `.execute(db);
  // Checked at commit, so an ownership transfer may demote and promote within one transaction.
  await sql`
    CREATE FUNCTION ensure_account_has_owner() RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE target uuid := coalesce(OLD.account_id, NEW.account_id);
      BEGIN
        IF EXISTS (SELECT 1 FROM accounts WHERE id = target)
           AND NOT EXISTS (
             SELECT 1 FROM account_members WHERE account_id = target AND role = 'owner'
           ) THEN
          RAISE EXCEPTION 'account % must have an owner', target;
        END IF;
        RETURN NULL;
      END $$
  `.execute(db);
  await sql`
    CREATE CONSTRAINT TRIGGER account_members_owner_required
      AFTER UPDATE OR DELETE ON account_members
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION ensure_account_has_owner()
  `.execute(db);

  await sql`
    CREATE TABLE account_invitations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL REFERENCES accounts (id),
      email text NOT NULL CHECK (email = lower(btrim(email))),
      role text NOT NULL CHECK (role IN ('admin', 'member')),
      -- SHA-256 of the token sent by email; the token itself is never stored.
      token_hash text NOT NULL UNIQUE,
      invited_by uuid NOT NULL REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      accepted_at timestamptz,
      accepted_by uuid REFERENCES users (id),
      revoked_at timestamptz
    )
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX account_invitations_pending_idx ON account_invitations (account_id, email)
      WHERE accepted_at IS NULL AND revoked_at IS NULL
  `.execute(db);

  // --- RLS -----------------------------------------------------------------------------------
  // account_members: rows of the current account, plus the user's own memberships everywhere
  // (needed to list "my accounts" and to resolve access before an account is selected).
  await forceRls(db, 'account_members');
  await sql`
    CREATE POLICY member_visibility ON account_members FOR SELECT
      USING (account_id = app_current_account_id() OR user_id = app_current_user_id())
  `.execute(db);
  await sql`
    CREATE POLICY member_management ON account_members FOR ALL
      USING (account_id = app_current_account_id())
      WITH CHECK (account_id = app_current_account_id())
  `.execute(db);

  // accounts: the current account, plus every account the user is a member of.
  await sql`DROP POLICY account_isolation ON accounts`.execute(db);
  await sql`
    CREATE POLICY account_visibility ON accounts FOR SELECT
      USING (
        id = app_current_account_id()
        OR EXISTS (
          SELECT 1 FROM account_members m
          WHERE m.account_id = accounts.id AND m.user_id = app_current_user_id()
        )
      )
  `.execute(db);
  await sql`
    CREATE POLICY account_update ON accounts FOR UPDATE
      USING (id = app_current_account_id())
      WITH CHECK (id = app_current_account_id())
  `.execute(db);

  // users: self, plus members of the current account.
  await forceRls(db, 'users');
  await sql`
    CREATE POLICY user_visibility ON users FOR SELECT
      USING (
        id = app_current_user_id()
        OR EXISTS (
          SELECT 1 FROM account_members m
          WHERE m.user_id = users.id AND m.account_id = app_current_account_id()
        )
      )
  `.execute(db);
  await sql`
    CREATE POLICY user_self_update ON users FOR UPDATE
      USING (id = app_current_user_id())
      WITH CHECK (id = app_current_user_id())
  `.execute(db);

  await forceRls(db, 'user_identities');
  await sql`
    CREATE POLICY identity_owner ON user_identities FOR SELECT
      USING (user_id = app_current_user_id())
  `.execute(db);

  await enableAccountRls(db, 'account_invitations');

  // --- Grants ----------------------------------------------------------------------------------
  // password_hash is deliberately absent from the app role's column grants.
  await sql`
    GRANT SELECT (id, email, email_verified_at, display_name, locale, status, created_at, updated_at)
      ON users TO ${sql.id(app)}
  `.execute(db);
  await sql`GRANT UPDATE (display_name, locale) ON users TO ${sql.id(app)}`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE ON users TO ${sql.id(system)}`.execute(db);

  await sql`GRANT SELECT (id, user_id, provider, email, created_at) ON user_identities TO ${sql.id(app)}`.execute(
    db,
  );
  await sql`GRANT SELECT, INSERT, DELETE ON user_identities TO ${sql.id(system)}`.execute(db);

  await sql`GRANT SELECT, INSERT, DELETE ON account_members TO ${sql.id(app)}`.execute(db);
  await sql`GRANT UPDATE (role) ON account_members TO ${sql.id(app)}`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON account_members TO ${sql.id(system)}`.execute(db);

  await sql`GRANT SELECT, INSERT ON account_invitations TO ${sql.id(app)}`.execute(db);
  await sql`GRANT UPDATE (revoked_at) ON account_invitations TO ${sql.id(app)}`.execute(db);
  await sql`GRANT SELECT, UPDATE ON account_invitations TO ${sql.id(system)}`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP POLICY account_update ON accounts`.execute(db);
  await sql`DROP POLICY account_visibility ON accounts`.execute(db);
  await sql`
    CREATE POLICY account_isolation ON accounts
      USING (id = app_current_account_id())
      WITH CHECK (id = app_current_account_id())
  `.execute(db);
  // users' policy references account_members, so policies go before the tables.
  await sql`DROP POLICY user_visibility ON users`.execute(db);
  await sql`DROP TABLE account_invitations`.execute(db);
  await sql`DROP TABLE account_members`.execute(db);
  await sql`DROP FUNCTION ensure_account_has_owner()`.execute(db);
  await sql`DROP TABLE user_identities`.execute(db);
  await sql`DROP TABLE users`.execute(db);
}
