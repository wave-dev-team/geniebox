import { type Kysely, sql } from 'kysely';

import { DB_ROLES } from '../roles.js';
import { enableAccountRls, forceRls } from './helpers.js';

const { app, system } = DB_ROLES;

/**
 * Projects live inside an account: the account is the RLS boundary, the project is
 * what the user sees. Child tables of later slices reference `(account_id, id)`, so a row can
 * never point at a project of another account. Enumerations mirror the settings screens
 * and onboarding; the application validates the same lists.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL REFERENCES accounts (id),
      slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
      name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
      sphere text CHECK (sphere IN (
        'subscription', 'ecommerce', 'online_school', 'saas', 'services', 'media',
        'personal', 'open_source', 'other'
      )),
      about text CHECK (length(about) <= 2000),
      goals text[] NOT NULL DEFAULT '{}' CHECK (cardinality(goals) <= 10),
      month_goal text CHECK (length(month_goal) <= 300),

      main_metric text NOT NULL DEFAULT 'revenue' CHECK (main_metric IN (
        'revenue', 'active_subscriptions', 'subscribers', 'uptime', 'custom'
      )),
      custom_metric text CHECK (length(custom_metric) <= 100),
      currency text NOT NULL DEFAULT 'RUB' CHECK (currency IN ('RUB', 'USD', 'EUR', 'KZT')),
      timezone text NOT NULL DEFAULT 'Europe/Moscow' CHECK (length(timezone) BETWEEN 1 AND 64),
      number_format text NOT NULL DEFAULT 'space_comma'
        CHECK (number_format IN ('space_comma', 'comma_dot')),
      date_format text NOT NULL DEFAULT 'dd.mm.yyyy'
        CHECK (date_format IN ('dd.mm.yyyy', 'yyyy-mm-dd', 'mm/dd/yyyy')),
      week_start text NOT NULL DEFAULT 'monday' CHECK (week_start IN ('monday', 'sunday')),

      client_language text NOT NULL DEFAULT 'ru' CHECK (client_language IN ('ru', 'en', 'kk', 'uk')),
      client_tone text NOT NULL DEFAULT 'friendly'
        CHECK (client_tone IN ('friendly', 'business', 'neutral')),
      client_address text NOT NULL DEFAULT 'formal' CHECK (client_address IN ('formal', 'informal')),
      client_signature text CHECK (length(client_signature) <= 200),

      default_trust_level text NOT NULL DEFAULT 'approve_all'
        CHECK (default_trust_level IN ('approve_all', 'approve_important', 'autonomous')),
      probation_days smallint NOT NULL DEFAULT 30 CHECK (probation_days IN (14, 30, 60)),
      trust_streak smallint NOT NULL DEFAULT 10 CHECK (trust_streak IN (5, 10, 20)),
      -- Onboarding pre-selects these four; H02 adds publishing on behalf of the project.
      always_ask text[] NOT NULL
        DEFAULT '{discount_over_20,mailing_over_500,spend_over_10000,release_changes}'
        CHECK (cardinality(always_ask) <= 20),
      agent_rules text[] NOT NULL DEFAULT '{}' CHECK (cardinality(agent_rules) <= 50),
      -- Monthly AI spend cap in roubles.
      ai_budget_monthly integer NOT NULL DEFAULT 20000
        CHECK (ai_budget_monthly BETWEEN 0 AND 100000000),
      -- Agent templates picked during onboarding; hired as real agents afterwards.
      planned_agents text[] NOT NULL DEFAULT '{}' CHECK (cardinality(planned_agents) <= 20),

      journal_retention_days integer NOT NULL DEFAULT 365
        CHECK (journal_retention_days IN (90, 365, 1095)),
      client_data_retention_days integer NOT NULL DEFAULT 90
        CHECK (client_data_retention_days IN (30, 90, 365)),

      -- Project-level kill switch; paused_until NULL means "until resumed".
      agents_paused boolean NOT NULL DEFAULT false,
      paused_until timestamptz,

      -- 1..5 while the onboarding wizard is in progress, NULL once finished.
      onboarding_step smallint DEFAULT 1 CHECK (onboarding_step BETWEEN 1 AND 5),
      onboarding_completed_at timestamptz,

      created_by uuid NOT NULL REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      UNIQUE (account_id, id)
    )
  `.execute(db);
  // Slugs are global: the URL /p/<slug> must resolve unambiguously for users of many accounts.
  await sql`
    CREATE UNIQUE INDEX projects_slug_idx ON projects (slug) WHERE deleted_at IS NULL
  `.execute(db);
  await sql`CREATE INDEX projects_account_idx ON projects (account_id, created_at)`.execute(db);
  await sql`
    CREATE TRIGGER projects_touch BEFORE UPDATE ON projects
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at()
  `.execute(db);

  await enableAccountRls(db, 'projects');
  // The project switcher lists projects of every account the user belongs to.
  await sql`
    CREATE POLICY project_member_visibility ON projects FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM account_members m
          WHERE m.account_id = projects.account_id AND m.user_id = app_current_user_id()
        )
      )
  `.execute(db);

  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO ${sql.id(app)}`.execute(db);
  await sql`GRANT SELECT, UPDATE, DELETE ON projects TO ${sql.id(system)}`.execute(db);

  // Requests from the Help screen. Owned by the user, not by an account.
  await sql`
    CREATE TABLE support_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id),
      project_id uuid REFERENCES projects (id) ON DELETE SET NULL,
      kind text NOT NULL CHECK (kind IN ('support', 'turnkey')),
      topic text CHECK (length(topic) <= 50),
      services text[] NOT NULL DEFAULT '{}' CHECK (cardinality(services) <= 10),
      message text NOT NULL CHECK (length(message) BETWEEN 1 AND 5000),
      contact text CHECK (length(contact) <= 200),
      preferred_time text CHECK (length(preferred_time) <= 100),
      attach_journal boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX support_requests_user_idx ON support_requests (user_id)`.execute(db);
  await forceRls(db, 'support_requests');
  await sql`
    CREATE POLICY support_request_owner ON support_requests
      USING (user_id = app_current_user_id())
      WITH CHECK (user_id = app_current_user_id())
  `.execute(db);
  await sql`GRANT SELECT, INSERT ON support_requests TO ${sql.id(app)}`.execute(db);
  await sql`GRANT SELECT ON support_requests TO ${sql.id(system)}`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE support_requests`.execute(db);
  await sql`DROP TABLE projects`.execute(db);
}
