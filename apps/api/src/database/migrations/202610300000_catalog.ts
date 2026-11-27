import { type Kysely, sql } from 'kysely';

import { DB_ROLES } from '../roles.js';
import { AGENT_TEMPLATES_V1 } from './data/agent-templates-v1.js';

const { app, system } = DB_ROLES;

/**
 * Agent catalog in the database: templates with versioned content (card, prompt,
 * tools with modes, data, limits, asks, scenarios). Only the system role writes it; the
 * app and the worker read it. Agents are pinned to the version they run on. The 15 templates
 * that lived in code become published v1, and every hired agent is pinned to it.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE agent_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      key text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
      category text NOT NULL CHECK (category IN ('marketing', 'support', 'analytics', 'tech')),
      icon text NOT NULL CHECK (length(icon) BETWEEN 1 AND 30),
      -- none: not in the marketplace (never published or taken down); beta: listed accounts only.
      availability text NOT NULL DEFAULT 'none' CHECK (availability IN ('none', 'all', 'beta')),
      beta_account_ids uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(beta_account_ids) <= 500),
      published_version_id uuid,
      unpublished_at timestamptz,
      unpublished_reason text CHECK (length(unpublished_reason) <= 500),
      created_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE TRIGGER agent_templates_touch BEFORE UPDATE ON agent_templates
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at()
  `.execute(db);

  await sql`
    CREATE TABLE agent_template_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id uuid NOT NULL REFERENCES agent_templates (id) ON DELETE CASCADE,
      number integer NOT NULL CHECK (number > 0),
      state text NOT NULL CHECK (state IN ('draft', 'published', 'previous', 'archived')),
      content jsonb NOT NULL CHECK (octet_length(content::text) <= 200000),
      -- jsonb text is canonical (sorted keys), so equal content gives an equal hash.
      content_hash text NOT NULL GENERATED ALWAYS AS (md5(content::text)) STORED,
      note text CHECK (length(note) <= 500),
      created_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid REFERENCES users (id),
      updated_at timestamptz NOT NULL DEFAULT now(),
      published_at timestamptz,
      published_by uuid REFERENCES users (id),
      -- {mode: now|gradual, stage: 10|50|100, nextAt}
      rollout jsonb,
      -- {requestedBy, requestedAt, approvedBy, approvedAt, contentHash}
      review jsonb,
      -- {contentHash, status: running|done|failed, startedAt, finishedAt, by, results[]}
      scenario_run jsonb,
      UNIQUE (template_id, number)
    )
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX agent_template_versions_one_draft ON agent_template_versions (template_id)
      WHERE state = 'draft'
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX agent_template_versions_one_published ON agent_template_versions (template_id)
      WHERE state = 'published'
  `.execute(db);
  await sql`
    CREATE TRIGGER agent_template_versions_touch BEFORE UPDATE ON agent_template_versions
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at()
  `.execute(db);
  await sql`
    ALTER TABLE agent_templates ADD CONSTRAINT agent_templates_published_version_fk
      FOREIGN KEY (published_version_id) REFERENCES agent_template_versions (id)
  `.execute(db);

  await sql`
    ALTER TABLE agents ADD COLUMN template_version_id uuid REFERENCES agent_template_versions (id)
  `.execute(db);
  await sql`CREATE INDEX agents_template_version_idx ON agents (template_version_id)`.execute(db);

  // --- v1 from code ---------------------------------------------------------------------------
  // agents has FORCE RLS even for its owner: lift it for the one-off pinning, then restore.
  await sql`ALTER TABLE agents NO FORCE ROW LEVEL SECURITY`.execute(db);
  for (const template of AGENT_TEMPLATES_V1) {
    const row = await sql<{ id: string }>`
      INSERT INTO agent_templates (key, category, icon, availability, created_at)
      VALUES (${template.key}, ${template.category}, ${template.icon}, 'all', clock_timestamp())
      RETURNING id
    `.execute(db);
    const templateId = row.rows[0]!.id;
    const version = await sql<{ id: string }>`
      INSERT INTO agent_template_versions (template_id, number, state, content, note, published_at)
      VALUES (${templateId}, 1, 'published', ${JSON.stringify(template.content)}::jsonb, 'Первая версия', now())
      RETURNING id
    `.execute(db);
    const versionId = version.rows[0]!.id;
    await sql`UPDATE agent_templates SET published_version_id = ${versionId} WHERE id = ${templateId}`.execute(
      db,
    );
    await sql`
      UPDATE agents SET template_version_id = ${versionId}
      WHERE template_key = ${template.key} AND kind = 'agent'
    `.execute(db);
  }
  await sql`ALTER TABLE agents FORCE ROW LEVEL SECURITY`.execute(db);

  // --- Access ---------------------------------------------------------------------------------
  for (const role of [app, system]) {
    await sql`GRANT SELECT ON agent_templates, agent_template_versions TO ${sql.id(role)}`.execute(db);
  }
  await sql`
    GRANT INSERT, UPDATE, DELETE ON agent_templates, agent_template_versions TO ${sql.id(system)}
  `.execute(db);
  // Publication, rollback and the rollout sweep move agents between versions (system).
  // The catalog cache of every process reads which versions agents are pinned to (system).
  await sql`GRANT UPDATE (template_version_id) ON agents TO ${sql.id(system)}`.execute(db);
  await sql`GRANT SELECT (id, template_key, template_version_id, deleted_at, kind) ON agents TO ${sql.id(system)}`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX agents_template_version_idx`.execute(db);
  await sql`ALTER TABLE agents DROP COLUMN template_version_id`.execute(db);
  await sql`ALTER TABLE agent_templates DROP CONSTRAINT agent_templates_published_version_fk`.execute(db);
  await sql`DROP TABLE agent_template_versions`.execute(db);
  await sql`DROP TABLE agent_templates`.execute(db);
}
