import { type Kysely, sql } from 'kysely';

import { DB_ROLES } from '../roles.js';
import { enableAccountRls } from './helpers.js';

const { app, system } = DB_ROLES;

/**
 * Metrics and results: official metric definitions and their daily points,
 * raw events from connections (monthly partitions), insights of the day, ideas with
 * experiments and the checks that confirm them. Official definitions are written only through
 * the API by people; agents have no tool that writes them.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE metric_definitions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      project_id uuid NOT NULL,
      key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,40}$'),
      title text NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
      unit text NOT NULL CHECK (unit IN ('money', 'count', 'percent')),
      -- sum: a flow per day (revenue); last: a state at the end of the day (active subscriptions).
      aggregation text NOT NULL CHECK (aggregation IN ('sum', 'last')),
      good_direction text NOT NULL DEFAULT 'up' CHECK (good_direction IN ('up', 'down')),
      -- {"kind": "yookassa.revenue" | ..., "params": {...}}; NULL until a person picks a source.
      source jsonb,
      connection_id uuid,
      pinned boolean NOT NULL DEFAULT false,
      position integer NOT NULL DEFAULT 0,
      collected_at timestamptz,
      -- Last run, successful or not: the maintenance sweep re-queues a metric an hour after it.
      attempted_at timestamptz,
      last_error text CHECK (length(last_error) <= 200),
      created_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (account_id, project_id) REFERENCES projects (account_id, id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, connection_id) REFERENCES connections (account_id, id)
        ON DELETE SET NULL (connection_id),
      UNIQUE (account_id, id),
      UNIQUE (project_id, key)
    )
  `.execute(db);

  await sql`
    CREATE TABLE metric_points (
      account_id uuid NOT NULL,
      metric_id uuid NOT NULL,
      day date NOT NULL,
      value numeric(20, 4) NOT NULL,
      collected_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (metric_id, day),
      FOREIGN KEY (account_id, metric_id) REFERENCES metric_definitions (account_id, id) ON DELETE CASCADE
    )
  `.execute(db);

  // Raw events from connections. Partitioned by month; partitions are created ahead by the
  // worker through ensure_event_partitions(), anything outside lands in the default one.
  await sql`
    CREATE TABLE events (
      account_id uuid NOT NULL,
      project_id uuid NOT NULL,
      source text NOT NULL CHECK (source ~ '^[a-z][a-z0-9_]{1,40}$'),
      type text NOT NULL CHECK (type ~ '^[a-z][a-z0-9_.]{1,60}$'),
      external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 120),
      occurred_at timestamptz NOT NULL,
      amount numeric(20, 4),
      currency text CHECK (currency ~ '^[A-Z]{3}$'),
      props jsonb NOT NULL DEFAULT '{}',
      ingested_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (project_id, source, external_id, occurred_at)
    ) PARTITION BY RANGE (occurred_at)
  `.execute(db);
  await sql`CREATE TABLE events_default PARTITION OF events DEFAULT`.execute(db);
  await sql`CREATE INDEX events_project_type_idx ON events (project_id, type, occurred_at)`.execute(db);
  await sql`
    CREATE FUNCTION ensure_event_partitions(months_ahead integer) RETURNS integer
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    DECLARE
      start date := date_trunc('month', now())::date;
      created integer := 0;
      name text;
    BEGIN
      IF months_ahead < 0 OR months_ahead > 12 THEN
        RAISE EXCEPTION 'months_ahead out of range';
      END IF;
      FOR i IN 0..months_ahead LOOP
        name := 'events_' || to_char(start + make_interval(months => i), 'YYYY_MM');
        IF to_regclass(name) IS NULL THEN
          EXECUTE format(
            'CREATE TABLE %I PARTITION OF events FOR VALUES FROM (%L) TO (%L)',
            name, start + make_interval(months => i), start + make_interval(months => i + 1)
          );
          created := created + 1;
        END IF;
      END LOOP;
      RETURN created;
    END
    $$
  `.execute(db);
  await sql`REVOKE ALL ON FUNCTION ensure_event_partitions(integer) FROM PUBLIC`.execute(db);
  await sql`GRANT EXECUTE ON FUNCTION ensure_event_partitions(integer) TO ${sql.id(system)}`.execute(db);
  await sql`SELECT ensure_event_partitions(2)`.execute(db);

  await sql`
    CREATE TABLE insights (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      project_id uuid NOT NULL,
      agent_id uuid NOT NULL,
      task_id uuid,
      text text NOT NULL CHECK (length(text) BETWEEN 1 AND 600),
      -- «Как посчитано»: [{"label", "value", "highlight"}]
      facts jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_array_length(facts) <= 10),
      note text CHECK (length(note) <= 300),
      period_days integer CHECK (period_days BETWEEN 1 AND 90),
      decision_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (account_id, project_id) REFERENCES projects (account_id, id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, agent_id) REFERENCES agents (account_id, id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, decision_id) REFERENCES decisions (account_id, id)
        ON DELETE SET NULL (decision_id)
    )
  `.execute(db);
  await sql`CREATE INDEX insights_project_idx ON insights (project_id, created_at DESC)`.execute(db);

  await sql`
    CREATE TABLE ideas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      project_id uuid NOT NULL,
      agent_id uuid NOT NULL,
      decision_id uuid,
      metric_key text NOT NULL CHECK (metric_key ~ '^[a-z][a-z0-9_]{1,40}$'),
      title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
      status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'adopted', 'rejected')),
      -- {"controlPct", "durationDays", "minSample", "guardrails": [...]}
      experiment jsonb NOT NULL,
      -- In the metric's units per month; set only by a check with a control comparison.
      effect_value numeric(20, 4),
      comparison text CHECK (length(comparison) <= 160),
      confidence text CHECK (length(confidence) <= 160),
      outcome text CHECK (length(outcome) <= 160),
      sample integer CHECK (sample >= 0),
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz,
      FOREIGN KEY (account_id, project_id) REFERENCES projects (account_id, id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, agent_id) REFERENCES agents (account_id, id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, decision_id) REFERENCES decisions (account_id, id)
        ON DELETE SET NULL (decision_id),
      UNIQUE (account_id, id),
      UNIQUE (decision_id)
    )
  `.execute(db);
  await sql`CREATE INDEX ideas_project_idx ON ideas (project_id, started_at DESC)`.execute(db);

  await sql`
    CREATE TABLE checks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      project_id uuid NOT NULL,
      agent_id uuid NOT NULL,
      decision_id uuid,
      idea_id uuid,
      what text NOT NULL CHECK (length(what) BETWEEN 1 AND 160),
      due_at timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'done', 'failed')),
      verdict text CHECK (verdict IN ('worked', 'not_worked', 'inconclusive')),
      result text CHECK (length(result) <= 600),
      task_id uuid,
      finished_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (account_id, project_id) REFERENCES projects (account_id, id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, agent_id) REFERENCES agents (account_id, id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, decision_id) REFERENCES decisions (account_id, id)
        ON DELETE SET NULL (decision_id),
      FOREIGN KEY (account_id, idea_id) REFERENCES ideas (account_id, id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, task_id) REFERENCES tasks (account_id, id) ON DELETE SET NULL (task_id),
      UNIQUE (decision_id),
      UNIQUE (task_id)
    )
  `.execute(db);
  await sql`CREATE INDEX checks_project_idx ON checks (project_id, status, due_at)`.execute(db);
  await sql`CREATE INDEX checks_agent_idx ON checks (agent_id, finished_at)`.execute(db);

  // What the agent promised to check with a control group (propose_decision → idea and check).
  await sql`ALTER TABLE decisions ADD COLUMN experiment jsonb`.execute(db);
  await sql`ALTER TABLE decisions ADD COLUMN check_spec jsonb`.execute(db);
  // Which connection a tool call used (journal filter, J02).
  await sql`ALTER TABLE tool_calls ADD COLUMN connection_id uuid`.execute(db);
  await sql`CREATE INDEX tool_calls_project_idx ON tool_calls (project_id, created_at DESC)`.execute(db);

  for (const table of ['metric_definitions', 'metric_points', 'events', 'insights', 'ideas', 'checks']) {
    await enableAccountRls(db, table);
  }
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON metric_definitions, metric_points TO ${sql.id(app)}`.execute(
    db,
  );
  await sql`GRANT SELECT, INSERT, UPDATE ON events, ideas, checks TO ${sql.id(app)}`.execute(db);
  await sql`GRANT SELECT, INSERT ON insights TO ${sql.id(app)}`.execute(db);
  // Collection sweep across accounts: ids and timestamps only.
  await sql`GRANT SELECT (id, account_id, source, attempted_at) ON metric_definitions TO ${sql.id(system)}`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX tool_calls_project_idx`.execute(db);
  await sql`ALTER TABLE tool_calls DROP COLUMN connection_id`.execute(db);
  await sql`ALTER TABLE decisions DROP COLUMN check_spec`.execute(db);
  await sql`ALTER TABLE decisions DROP COLUMN experiment`.execute(db);
  await sql`DROP TABLE checks`.execute(db);
  await sql`DROP TABLE ideas`.execute(db);
  await sql`DROP TABLE insights`.execute(db);
  await sql`DROP FUNCTION ensure_event_partitions(integer)`.execute(db);
  await sql`DROP TABLE events`.execute(db);
  await sql`DROP TABLE metric_points`.execute(db);
  await sql`DROP TABLE metric_definitions`.execute(db);
}
