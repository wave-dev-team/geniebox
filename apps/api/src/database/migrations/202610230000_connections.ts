import { type Kysely, sql } from 'kysely';

import { DB_ROLES } from '../roles.js';
import { enableAccountRls } from './helpers.js';

const { app, system } = DB_ROLES;

/**
 * Connections of a project to outside services.
 * Secret values live only in connection_credentials, sealed by the application (envelope
 * encryption, KEK outside the database); everything else about a connection is plain config.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE connections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      project_id uuid NOT NULL,
      provider_key text NOT NULL CHECK (provider_key ~ '^[a-z][a-z0-9_]{1,40}$'),
      name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
      access_level text NOT NULL DEFAULT 'read' CHECK (access_level IN ('read', 'read_write')),
      -- Non-secret settings: URLs, ids, user names, the SSH public key.
      config jsonb NOT NULL DEFAULT '{}',
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'warn', 'error')),
      -- Machine code of the last check outcome (CHECK_FAILED, UNAUTHORIZED, …) and a short
      -- human detail from the provider; never contains secret values.
      status_reason text CHECK (length(status_reason) <= 50),
      status_detail text CHECK (length(status_detail) <= 300),
      last_check_at timestamptz,
      last_sync_at timestamptz,
      created_via text NOT NULL DEFAULT 'user' CHECK (created_via IN ('user', 'dev_link')),
      created_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      FOREIGN KEY (account_id, project_id) REFERENCES projects (account_id, id) ON DELETE CASCADE,
      UNIQUE (account_id, id)
    )
  `.execute(db);
  await sql`
    CREATE INDEX connections_project_idx ON connections (project_id) WHERE deleted_at IS NULL
  `.execute(db);
  await sql`
    CREATE INDEX connections_recheck_idx ON connections (last_check_at) WHERE deleted_at IS NULL
  `.execute(db);
  await sql`
    CREATE TRIGGER connections_touch BEFORE UPDATE ON connections
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at()
  `.execute(db);

  await sql`
    CREATE TABLE connection_credentials (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      project_id uuid NOT NULL,
      connection_id uuid NOT NULL,
      version integer NOT NULL CHECK (version > 0),
      -- iv | tag | AES-256-GCM ciphertext of the JSON secret; AAD = account|project|credential.
      ciphertext bytea NOT NULL,
      wrapped_key bytea NOT NULL,
      kek_id text NOT NULL CHECK (kek_id ~ '^[0-9a-f]{16}$'),
      -- Display only, e.g. ••••a91f.
      masked text NOT NULL CHECK (length(masked) <= 40),
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retiring', 'revoked')),
      expires_at timestamptz,
      -- A replaced credential keeps working until then, so in-flight work finishes.
      retire_at timestamptz,
      created_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (account_id, connection_id) REFERENCES connections (account_id, id)
        ON DELETE CASCADE,
      UNIQUE (connection_id, version)
    )
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX connection_credentials_active_idx ON connection_credentials (connection_id)
      WHERE status = 'active'
  `.execute(db);
  await sql`
    CREATE TRIGGER connection_credentials_touch BEFORE UPDATE ON connection_credentials
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at()
  `.execute(db);

  // One-time links for a developer. The token itself is never stored.
  await sql`
    CREATE TABLE connection_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      project_id uuid NOT NULL,
      provider_key text NOT NULL CHECK (provider_key ~ '^[a-z][a-z0-9_]{1,40}$'),
      token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      revoked_at timestamptz,
      connection_id uuid,
      created_by uuid NOT NULL REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (account_id, project_id) REFERENCES projects (account_id, id) ON DELETE CASCADE
    )
  `.execute(db);
  await sql`CREATE INDEX connection_links_project_idx ON connection_links (project_id)`.execute(db);

  for (const table of ['connections', 'connection_credentials', 'connection_links']) {
    await enableAccountRls(db, table);
  }

  await sql`GRANT SELECT, INSERT, UPDATE ON connections TO ${sql.id(app)}`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON connection_credentials TO ${sql.id(app)}`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE ON connection_links TO ${sql.id(app)}`.execute(db);
  // System role: resolve a developer link before any account is known, and find connections
  // due for a re-check across accounts. Ids and timestamps only, no secrets.
  await sql`
    GRANT SELECT (id, account_id, project_id, provider_key, token_hash, expires_at, used_at,
      revoked_at) ON connection_links TO ${sql.id(system)}
  `.execute(db);
  await sql`
    GRANT SELECT (id, account_id, last_check_at, deleted_at) ON connections TO ${sql.id(system)}
  `.execute(db);
  // Destroying replaced credentials after their grace period is a cross-account sweep.
  await sql`GRANT SELECT (id, status, retire_at), DELETE ON connection_credentials TO ${sql.id(system)}`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE connection_links`.execute(db);
  await sql`DROP TABLE connection_credentials`.execute(db);
  await sql`DROP TABLE connections`.execute(db);
}
