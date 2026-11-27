import { type Kysely, sql } from 'kysely';

import { DB_ROLES } from '../roles.js';
import { enableAccountRls } from './helpers.js';

const { app, system } = DB_ROLES;

export async function up(db: Kysely<unknown>): Promise<void> {
  // Missing or empty setting yields NULL, so a query without context matches no rows.
  await sql`
    CREATE FUNCTION app_current_account_id() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('app.account_id', true), '')::uuid $$
  `.execute(db);
  await sql`
    CREATE FUNCTION app_current_user_id() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$
  `.execute(db);

  await sql`
    CREATE FUNCTION forbid_modification() RETURNS trigger
      LANGUAGE plpgsql
      AS $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$
  `.execute(db);

  await sql`
    CREATE FUNCTION touch_updated_at() RETURNS trigger
      LANGUAGE plpgsql
      AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$
  `.execute(db);

  // accounts: the isolation boundary (tenant). Membership-aware policy is added with users.
  await sql`
    CREATE TABLE accounts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
      name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
      locale text NOT NULL DEFAULT 'ru' CHECK (locale IN ('ru', 'en')),
      -- Kill switch: agents may not perform mutating actions while false. Safe default.
      agent_actions_enabled boolean NOT NULL DEFAULT false,
      -- Blocked by platform moderation: agents stop and members cannot sign in.
      blocked_at timestamptz,
      blocked_reason text CHECK (length(blocked_reason) <= 500),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE TRIGGER accounts_touch BEFORE UPDATE ON accounts
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at()
  `.execute(db);
  await enableAccountRls(db, 'accounts', 'id');
  await sql`GRANT SELECT ON accounts TO ${sql.id(app)}`.execute(db);
  await sql`GRANT UPDATE (name, locale) ON accounts TO ${sql.id(app)}`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE ON accounts TO ${sql.id(system)}`.execute(db);

  // outbox_events: written in the business transaction, published by the relay.
  // account_id is NULL for platform-level events (e.g. user.registered); only system writes those.
  await sql`
    CREATE TABLE outbox_events (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      event_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
      account_id uuid REFERENCES accounts (id),
      type text NOT NULL,
      payload jsonb NOT NULL,
      trace_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      published_at timestamptz
    )
  `.execute(db);
  await sql`
    CREATE INDEX outbox_events_unpublished_idx ON outbox_events (id) WHERE published_at IS NULL
  `.execute(db);
  await enableAccountRls(db, 'outbox_events');
  await sql`GRANT INSERT ON outbox_events TO ${sql.id(app)}`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON outbox_events TO ${sql.id(system)}`.execute(db);

  // action_journal: append-only audit of significant actions (users, agents, system).
  // account_id is NULL for platform-level actions (sign-in, password change).
  await sql`
    CREATE TABLE action_journal (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      account_id uuid REFERENCES accounts (id),
      occurred_at timestamptz NOT NULL DEFAULT now(),
      actor_type text NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
      actor_id text NOT NULL,
      actor_role text,
      action text NOT NULL,
      target_type text,
      target_id text,
      args jsonb,
      result jsonb,
      status text NOT NULL CHECK (status IN ('succeeded', 'failed', 'rejected')),
      trace_id text NOT NULL
    )
  `.execute(db);
  await sql`
    CREATE INDEX action_journal_account_time_idx ON action_journal (account_id, occurred_at DESC)
  `.execute(db);
  await sql`
    CREATE TRIGGER action_journal_append_only
      BEFORE UPDATE OR DELETE OR TRUNCATE ON action_journal
      FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification()
  `.execute(db);
  await enableAccountRls(db, 'action_journal');
  await sql`GRANT SELECT, INSERT ON action_journal TO ${sql.id(app)}`.execute(db);
  await sql`GRANT SELECT, INSERT ON action_journal TO ${sql.id(system)}`.execute(db);

  // scheduled_tasks: source of truth for long-delay jobs; BullMQ only executes them.
  await sql`
    CREATE TABLE scheduled_tasks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL REFERENCES accounts (id),
      type text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      run_at timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'enqueued', 'succeeded', 'failed', 'cancelled')),
      dedupe_key text,
      attempts integer NOT NULL DEFAULT 0,
      last_error text,
      trace_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (account_id, type, dedupe_key)
    )
  `.execute(db);
  await sql`
    CREATE INDEX scheduled_tasks_due_idx ON scheduled_tasks (run_at)
      WHERE status IN ('pending', 'enqueued')
  `.execute(db);
  await sql`
    CREATE TRIGGER scheduled_tasks_touch BEFORE UPDATE ON scheduled_tasks
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at()
  `.execute(db);
  await enableAccountRls(db, 'scheduled_tasks');
  await sql`GRANT SELECT, INSERT, UPDATE ON scheduled_tasks TO ${sql.id(app)}`.execute(db);
  await sql`GRANT SELECT, UPDATE ON scheduled_tasks TO ${sql.id(system)}`.execute(db);

  // idempotency_keys: durable results of mutating requests.
  await sql`
    CREATE TABLE idempotency_keys (
      account_id uuid NOT NULL REFERENCES accounts (id),
      key text NOT NULL CHECK (length(key) BETWEEN 8 AND 200),
      request_hash text NOT NULL,
      status text NOT NULL CHECK (status IN ('in_progress', 'completed')),
      response_status integer,
      response_body jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      PRIMARY KEY (account_id, key)
    )
  `.execute(db);
  await sql`CREATE INDEX idempotency_keys_expires_idx ON idempotency_keys (expires_at)`.execute(db);
  await enableAccountRls(db, 'idempotency_keys');
  await sql`GRANT SELECT, INSERT, UPDATE ON idempotency_keys TO ${sql.id(app)}`.execute(db);
  await sql`GRANT SELECT, DELETE ON idempotency_keys TO ${sql.id(system)}`.execute(db);

  await sql`
    GRANT EXECUTE ON FUNCTION app_current_account_id(), app_current_user_id()
      TO ${sql.id(app)}, ${sql.id(system)}
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    'idempotency_keys',
    'scheduled_tasks',
    'action_journal',
    'outbox_events',
    'accounts',
  ]) {
    await sql`DROP TABLE ${sql.table(table)}`.execute(db);
  }
  await sql`DROP FUNCTION touch_updated_at()`.execute(db);
  await sql`DROP FUNCTION forbid_modification()`.execute(db);
  await sql`DROP FUNCTION app_current_user_id()`.execute(db);
  await sql`DROP FUNCTION app_current_account_id()`.execute(db);
}
