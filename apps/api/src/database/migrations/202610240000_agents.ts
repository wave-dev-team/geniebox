import { type Kysely, sql } from 'kysely';

import { DB_ROLES } from '../roles.js';
import { enableAccountRls } from './helpers.js';

const { app } = DB_ROLES;

/**
 * Agents of a project: the manager (one per project, system) and hired agents
 * from the catalog or custom ones. Permissions, limits and instructions are written only by
 * people through the API; agents get no write path to these tables.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE agents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      project_id uuid NOT NULL,
      kind text NOT NULL DEFAULT 'agent' CHECK (kind IN ('manager', 'agent')),
      -- Catalog template; NULL for the manager and for custom agents.
      template_key text CHECK (template_key ~ '^[a-z][a-z0-9_]{1,40}$'),
      display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
      role_text text CHECK (length(role_text) <= 80),
      icon_kind text NOT NULL DEFAULT 'glyph' CHECK (icon_kind IN ('glyph', 'emoji', 'image')),
      icon_value text NOT NULL CHECK (length(icon_value) BETWEEN 1 AND 300),
      icon_bg text CHECK (icon_bg ~ '^[a-z0-9-]{1,30}$'),
      status text NOT NULL DEFAULT 'probation' CHECK (status IN ('active', 'probation', 'paused')),
      probation_until timestamptz,
      paused_until timestamptz,
      trust_level text NOT NULL DEFAULT 'approve_all'
        CHECK (trust_level IN ('approve_all', 'approve_important', 'autonomous')),
      -- Owner's rules «topic → rule»; [{"topic": "...", "rule": "..."}].
      instructions jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_array_length(instructions) <= 30),
      -- {"ai_budget_monthly": 3000, "quiet_hours": "22:00-09:00", ...}
      limits jsonb NOT NULL DEFAULT '{}',
      asks text[] NOT NULL DEFAULT '{}' CHECK (cardinality(asks) <= 30),
      -- Broker tools of a custom agent; catalog agents take them from the template.
      custom_tools text[] NOT NULL DEFAULT '{}' CHECK (cardinality(custom_tools) <= 50),
      hired_at timestamptz NOT NULL DEFAULT now(),
      hired_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      FOREIGN KEY (account_id, project_id) REFERENCES projects (account_id, id) ON DELETE CASCADE,
      UNIQUE (account_id, id)
    )
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX agents_manager_idx ON agents (project_id) WHERE kind = 'manager'
  `.execute(db);
  // One live agent per catalog template in a project.
  await sql`
    CREATE UNIQUE INDEX agents_template_idx ON agents (project_id, template_key)
      WHERE deleted_at IS NULL AND template_key IS NOT NULL
  `.execute(db);
  await sql`
    CREATE INDEX agents_project_idx ON agents (project_id) WHERE deleted_at IS NULL
  `.execute(db);
  await sql`
    CREATE TRIGGER agents_touch BEFORE UPDATE ON agents
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at()
  `.execute(db);

  await sql`
    CREATE TABLE agent_permissions (
      account_id uuid NOT NULL,
      agent_id uuid NOT NULL,
      action_id text NOT NULL CHECK (action_id ~ '^[a-z][a-z0-9_.]{1,60}$'),
      mode text NOT NULL CHECK (mode IN ('auto', 'notify', 'approve', 'deny')),
      updated_by uuid REFERENCES users (id),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (agent_id, action_id),
      FOREIGN KEY (account_id, agent_id) REFERENCES agents (account_id, id) ON DELETE CASCADE
    )
  `.execute(db);

  await sql`
    CREATE TABLE agent_connections (
      account_id uuid NOT NULL,
      agent_id uuid NOT NULL,
      connection_id uuid NOT NULL,
      access_level text NOT NULL CHECK (access_level IN ('read', 'read_write')),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (agent_id, connection_id),
      FOREIGN KEY (account_id, agent_id) REFERENCES agents (account_id, id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, connection_id) REFERENCES connections (account_id, id)
        ON DELETE CASCADE
    )
  `.execute(db);
  await sql`CREATE INDEX agent_connections_connection_idx ON agent_connections (connection_id)`.execute(db);

  // What the agent learned about the project. Written by agents
  //, deletable by people.
  await sql`
    CREATE TABLE agent_notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      agent_id uuid NOT NULL,
      text text NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (account_id, agent_id) REFERENCES agents (account_id, id) ON DELETE CASCADE
    )
  `.execute(db);
  await sql`CREATE INDEX agent_notes_agent_idx ON agent_notes (agent_id, created_at)`.execute(db);

  for (const table of ['agents', 'agent_permissions', 'agent_connections', 'agent_notes']) {
    await enableAccountRls(db, table);
  }
  await sql`GRANT SELECT, INSERT, UPDATE ON agents TO ${sql.id(app)}`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON agent_permissions TO ${sql.id(app)}`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON agent_connections TO ${sql.id(app)}`.execute(db);
  await sql`GRANT SELECT, INSERT, DELETE ON agent_notes TO ${sql.id(app)}`.execute(db);

  // Every existing project gets its manager.
  await sql`
    INSERT INTO agents (account_id, project_id, kind, display_name, icon_kind, icon_value, status,
                        trust_level, hired_by)
    SELECT account_id, id, 'manager', 'Управляющий', 'glyph', 'manager', 'active',
           'approve_important', created_by
    FROM projects WHERE deleted_at IS NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE agent_notes`.execute(db);
  await sql`DROP TABLE agent_connections`.execute(db);
  await sql`DROP TABLE agent_permissions`.execute(db);
  await sql`DROP TABLE agents`.execute(db);
}
