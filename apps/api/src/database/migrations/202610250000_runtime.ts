import { type Kysely, sql } from 'kysely';

import { DB_ROLES } from '../roles.js';
import { enableAccountRls } from './helpers.js';

const { app, system } = DB_ROLES;

/**
 * Agent runtime: conversations with the manager and
 * agents, tasks with steps, routines, decisions, every LLM call and every broker tool call,
 * kill switches on the platform and the account.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Global kill switch and other platform flags. Read without cache by the broker.
  await sql`
    CREATE TABLE platform_flags (
      key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,60}$'),
      enabled boolean NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`INSERT INTO platform_flags (key, enabled) VALUES ('agent_actions_enabled', true)`.execute(db);
  await sql`GRANT SELECT ON platform_flags TO ${sql.id(app)}`.execute(db);
  await sql`GRANT SELECT ON platform_flags TO ${sql.id(system)}`.execute(db);

  await sql`
    CREATE TABLE conversations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      project_id uuid NOT NULL,
      -- The manager or the agent the dialog is with.
      agent_id uuid NOT NULL,
      title text CHECK (length(title) <= 120),
      created_by uuid REFERENCES users (id),
      last_message_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (account_id, project_id) REFERENCES projects (account_id, id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, agent_id) REFERENCES agents (account_id, id) ON DELETE CASCADE,
      UNIQUE (account_id, id)
    )
  `.execute(db);
  await sql`
    CREATE INDEX conversations_project_idx ON conversations (project_id, agent_id, last_message_at DESC)
  `.execute(db);

  await sql`
    CREATE TABLE messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      conversation_id uuid NOT NULL,
      role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      author_user_id uuid REFERENCES users (id),
      -- Who answered: the manager or an agent.
      agent_id uuid,
      text text NOT NULL DEFAULT '' CHECK (length(text) <= 8000),
      status text NOT NULL DEFAULT 'done' CHECK (status IN ('streaming', 'done', 'failed')),
      -- Request mode of a user message.
      mode text CHECK (mode IN ('approve_all', 'approve_important', 'recommend_only')),
      -- «@agent»: the request goes straight to this agent.
      mention_agent_id uuid,
      -- Links to live entities: [{"type": "task" | "decision", "id": "..."}].
      cards jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_array_length(cards) <= 20),
      channel text NOT NULL DEFAULT 'web' CHECK (channel IN ('web')),
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (account_id, conversation_id) REFERENCES conversations (account_id, id)
        ON DELETE CASCADE,
      UNIQUE (account_id, id)
    )
  `.execute(db);
  await sql`CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at)`.execute(db);

  // Buttons under messages: the action stays on the server, the client sends only the id.
  await sql`
    CREATE TABLE message_actions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      message_id uuid NOT NULL,
      position smallint NOT NULL CHECK (position BETWEEN 0 AND 11),
      kind text NOT NULL CHECK (kind IN ('reply', 'action', 'link', 'decision')),
      label text NOT NULL CHECK (length(label) BETWEEN 1 AND 64),
      -- reply: {text}; link: {url}; action: {actionId, projectId, args, summary};
      -- decision: {decisionId, verdict, term?}
      payload jsonb NOT NULL DEFAULT '{}',
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed', 'expired')),
      result text CHECK (length(result) <= 300),
      used_by uuid REFERENCES users (id),
      used_at timestamptz,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (account_id, message_id) REFERENCES messages (account_id, id) ON DELETE CASCADE,
      UNIQUE (message_id, position)
    )
  `.execute(db);
  await enableAccountRls(db, 'message_actions');
  await sql`GRANT SELECT, INSERT, UPDATE ON message_actions TO ${sql.id(app)}`.execute(db);
  // A button press carries only the id: find whose it is (ids only).
  await sql`GRANT SELECT (id, account_id, message_id) ON message_actions TO ${sql.id(system)}`.execute(db);

  await sql`
    CREATE TABLE routines (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      project_id uuid NOT NULL,
      agent_id uuid NOT NULL,
      -- Stable key of a system routine («daily_digest»); NULL for routines people or agents add.
      kind text CHECK (kind ~ '^[a-z][a-z0-9_]{1,40}$'),
      title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
      description text CHECK (length(description) <= 1000),
      -- Schedule preset: every_5m, hourly, daily_09, daily_18, daily_21, weekly_mon_10,
      -- continuous. Times are in the project time zone.
      schedule text NOT NULL CHECK (schedule ~ '^[a-z0-9_]{3,30}$'),
      enabled boolean NOT NULL DEFAULT true,
      next_run_at timestamptz,
      last_run_at timestamptz,
      last_run_summary text CHECK (length(last_run_summary) <= 200),
      created_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (account_id, project_id) REFERENCES projects (account_id, id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, agent_id) REFERENCES agents (account_id, id) ON DELETE CASCADE,
      UNIQUE (account_id, id)
    )
  `.execute(db);
  await sql`CREATE INDEX routines_project_idx ON routines (project_id)`.execute(db);
  await sql`
    CREATE UNIQUE INDEX routines_kind_idx ON routines (project_id, kind) WHERE kind IS NOT NULL
  `.execute(db);
  await sql`
    CREATE TRIGGER routines_touch BEFORE UPDATE ON routines
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at()
  `.execute(db);

  await sql`
    CREATE TABLE tasks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      project_id uuid NOT NULL,
      agent_id uuid NOT NULL,
      title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
      -- Short status line under the title in lists («собирает ответы»).
      summary text CHECK (length(summary) <= 200),
      -- «Зачем» on the task card.
      description text CHECK (length(description) <= 2000),
      status text NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'running', 'waiting', 'failed', 'done', 'cancelled')),
      progress_text text CHECK (length(progress_text) <= 60),
      progress_pct smallint CHECK (progress_pct BETWEEN 0 AND 100),
      scheduled_at timestamptz,
      started_at timestamptz,
      finished_at timestamptz,
      origin text NOT NULL CHECK (origin IN ('owner', 'manager', 'agent', 'routine', 'check')),
      -- Request mode the task inherited; NULL = the agent's trust level.
      mode text CHECK (mode IN ('approve_all', 'approve_important', 'recommend_only')),
      routine_id uuid,
      conversation_id uuid,
      -- Result line for the conversation and lists.
      result text CHECK (length(result) <= 2000),
      -- [{"label": "Кому", "value": "200 ушедших за месяц"}]
      facts jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_array_length(facts) <= 12),
      -- {"what": "...", "fix": "...", "code": "..."}
      error jsonb,
      attempts smallint NOT NULL DEFAULT 0,
      created_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (account_id, project_id) REFERENCES projects (account_id, id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, agent_id) REFERENCES agents (account_id, id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, routine_id) REFERENCES routines (account_id, id) ON DELETE SET NULL (routine_id),
      FOREIGN KEY (account_id, conversation_id) REFERENCES conversations (account_id, id)
        ON DELETE SET NULL (conversation_id),
      UNIQUE (account_id, id)
    )
  `.execute(db);
  await sql`CREATE INDEX tasks_project_status_idx ON tasks (project_id, status, created_at DESC)`.execute(db);
  await sql`CREATE INDEX tasks_routine_idx ON tasks (routine_id, created_at DESC)`.execute(db);
  await sql`
    CREATE TRIGGER tasks_touch BEFORE UPDATE ON tasks
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at()
  `.execute(db);

  await sql`
    CREATE TABLE task_steps (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      task_id uuid NOT NULL,
      position smallint NOT NULL CHECK (position BETWEEN 0 AND 50),
      title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
      status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'current', 'done', 'failed')),
      at timestamptz,
      note text CHECK (length(note) <= 120),
      FOREIGN KEY (account_id, task_id) REFERENCES tasks (account_id, id) ON DELETE CASCADE,
      UNIQUE (task_id, position)
    )
  `.execute(db);

  await sql`
    CREATE TABLE decisions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      project_id uuid NOT NULL,
      agent_id uuid NOT NULL,
      task_id uuid,
      title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
      -- «992 клиента · 20% — контрольная группа»
      meta text CHECK (length(meta) <= 200),
      effect text CHECK (length(effect) <= 80),
      cost text CHECK (length(cost) <= 80),
      risk text NOT NULL DEFAULT 'low' CHECK (risk IN ('low', 'medium', 'high')),
      risk_note text CHECK (length(risk_note) <= 160),
      why jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_array_length(why) <= 8),
      -- [{"label": "Кому", "value": "992 ушедших клиента"}]
      plan jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_array_length(plan) <= 8),
      -- Changeable terms: {"label": "Скидка", "proposed": "30", "options": [{"value", "label",
      -- "effect", "cost"}]}; NULL when the decision has none.
      terms jsonb,
      selected_term text CHECK (length(selected_term) <= 40),
      yes_label text NOT NULL DEFAULT 'Да' CHECK (length(yes_label) BETWEEN 1 AND 40),
      yes_text text CHECK (length(yes_text) <= 200),
      -- Broker calls executed on «да»: [{"toolId": "...", "args": {...}}].
      pending_actions jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_array_length(pending_actions) <= 10),
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'modified', 'rejected', 'expired')),
      decided_by uuid REFERENCES users (id),
      decided_at timestamptz,
      decided_via text CHECK (decided_via IN ('web')),
      -- Rejected: the agent does not propose the same until then.
      cooldown_until timestamptz,
      expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (account_id, project_id) REFERENCES projects (account_id, id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, agent_id) REFERENCES agents (account_id, id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, task_id) REFERENCES tasks (account_id, id) ON DELETE SET NULL (task_id),
      UNIQUE (account_id, id)
    )
  `.execute(db);
  await sql`CREATE INDEX decisions_project_idx ON decisions (project_id, status, created_at DESC)`.execute(
    db,
  );
  await sql`CREATE INDEX decisions_task_idx ON decisions (task_id)`.execute(db);

  // Every LLM call: tokens, cost, latency, outcome. Written by the worker only.
  await sql`
    CREATE TABLE llm_calls (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      project_id uuid NOT NULL,
      agent_id uuid,
      task_id uuid,
      conversation_id uuid,
      role text NOT NULL CHECK (length(role) BETWEEN 1 AND 40),
      provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 30),
      model text NOT NULL CHECK (length(model) BETWEEN 1 AND 80),
      prompt_version text NOT NULL CHECK (length(prompt_version) BETWEEN 1 AND 40),
      tokens_in integer NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
      tokens_out integer NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
      cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
      cost_rub numeric(12, 2) NOT NULL DEFAULT 0,
      latency_ms integer NOT NULL DEFAULT 0,
      result text NOT NULL CHECK (result IN ('ok', 'error', 'timeout', 'invalid', 'budget')),
      error_code text CHECK (length(error_code) <= 60),
      trace_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (account_id, project_id) REFERENCES projects (account_id, id) ON DELETE CASCADE
    )
  `.execute(db);
  await sql`CREATE INDEX llm_calls_project_idx ON llm_calls (project_id, created_at)`.execute(db);
  await sql`CREATE INDEX llm_calls_agent_idx ON llm_calls (agent_id, created_at)`.execute(db);

  // Every broker call: what was asked, the mode it ran in, the outcome.
  await sql`
    CREATE TABLE tool_calls (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      project_id uuid NOT NULL,
      agent_id uuid NOT NULL,
      task_id uuid,
      decision_id uuid,
      tool_id text NOT NULL CHECK (tool_id ~ '^[a-z][a-z0-9_.]{1,60}$'),
      -- Arguments after validation, personal data masked.
      args jsonb NOT NULL DEFAULT '{}',
      mode text CHECK (mode IN ('auto', 'notify', 'approve', 'deny')),
      status text NOT NULL
        CHECK (status IN ('executed', 'approval', 'denied', 'rejected', 'failed', 'blocked')),
      error_code text CHECK (length(error_code) <= 60),
      -- Per task and arguments: a repeated call returns the first result.
      idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 120),
      approved_by uuid REFERENCES users (id),
      result jsonb,
      trace_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (account_id, project_id) REFERENCES projects (account_id, id) ON DELETE CASCADE,
      UNIQUE (account_id, idempotency_key)
    )
  `.execute(db);
  await sql`CREATE INDEX tool_calls_agent_idx ON tool_calls (agent_id, created_at)`.execute(db);

  for (const table of [
    'conversations',
    'messages',
    'routines',
    'tasks',
    'task_steps',
    'decisions',
    'llm_calls',
    'tool_calls',
  ]) {
    await enableAccountRls(db, table);
  }
  await sql`GRANT SELECT, INSERT, UPDATE ON conversations, messages, routines, tasks, decisions TO ${sql.id(app)}`.execute(
    db,
  );
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON task_steps TO ${sql.id(app)}`.execute(db);
  // Audit tables: insert and read only, no rewriting history.
  await sql`GRANT SELECT, INSERT ON llm_calls, tool_calls TO ${sql.id(app)}`.execute(db);
  await sql`GRANT UPDATE (status, error_code, result, approved_by, decision_id) ON tool_calls TO ${sql.id(app)}`.execute(
    db,
  );
  // Decision expiry sweep across accounts.
  await sql`GRANT SELECT (id, account_id, status, expires_at) ON decisions TO ${sql.id(system)}`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE tool_calls`.execute(db);
  await sql`DROP TABLE llm_calls`.execute(db);
  await sql`DROP TABLE decisions`.execute(db);
  await sql`DROP TABLE task_steps`.execute(db);
  await sql`DROP TABLE tasks`.execute(db);
  await sql`DROP TABLE routines`.execute(db);
  await sql`DROP TABLE messages`.execute(db);
  await sql`DROP TABLE conversations`.execute(db);
  await sql`DROP TABLE platform_flags`.execute(db);
}
