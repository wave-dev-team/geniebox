import { type Kysely, sql } from 'kysely';

import { DB_ROLES } from '../roles.js';
import { enableAccountRls } from './helpers.js';

const { app, system } = DB_ROLES;

const TABLES = [
  'knowledge_sources',
  'knowledge_nodes',
  'knowledge_revisions',
  'knowledge_citations',
  'knowledge_chunks',
  'knowledge_proposals',
];

/**
 * Knowledge base: immutable sources, the curated tree of pages (the source of truth for
 * agents), its history, citations to evidence, a derived search index with pgvector
 * embeddings, and the queue of agent proposals. Only published pages reach agents.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Available in the pgvector/pgvector image; created here so a plain cluster gets them too.
  await sql`CREATE EXTENSION IF NOT EXISTS vector`.execute(db);
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(db);

  await sql`
    CREATE TABLE knowledge_sources (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      project_id uuid NOT NULL,
      kind text NOT NULL CHECK (kind IN ('upload', 'text')),
      title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
      mime text CHECK (length(mime) <= 160),
      size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
      -- Content address: the same bytes are one source per project, never reprocessed twice.
      sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
      blob_key text NOT NULL CHECK (length(blob_key) BETWEEN 1 AND 400),
      status text NOT NULL DEFAULT 'processing'
        CHECK (status IN ('processing', 'ready', 'failed', 'archived')),
      error text CHECK (length(error) <= 300),
      -- Data period of the source, when it describes one: shown with every citation.
      period_start date,
      period_end date,
      -- {"sample", "segment", "method", "confidence", "limitations": [...]}
      metadata jsonb NOT NULL DEFAULT '{}',
      created_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (account_id, project_id) REFERENCES projects (account_id, id) ON DELETE CASCADE,
      UNIQUE (account_id, id),
      UNIQUE (account_id, project_id, sha256),
      CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
    )
  `.execute(db);
  await sql`CREATE INDEX knowledge_sources_project_idx ON knowledge_sources (project_id, created_at DESC)`.execute(
    db,
  );

  await sql`
    CREATE TABLE knowledge_nodes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      project_id uuid NOT NULL,
      parent_id uuid,
      kind text NOT NULL DEFAULT 'page' CHECK (kind IN ('folder', 'page')),
      title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
      body text NOT NULL DEFAULT '' CHECK (length(body) <= 200000),
      status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
      position integer NOT NULL DEFAULT 0,
      -- Hash of title and body: the index is rebuilt only when it changes.
      content_hash text,
      -- Hash the current chunks were built from: an unchanged page costs no tokens.
      indexed_hash text,
      source_id uuid,
      published_at timestamptz,
      published_by uuid REFERENCES users (id),
      created_by uuid REFERENCES users (id),
      updated_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (account_id, project_id) REFERENCES projects (account_id, id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, parent_id) REFERENCES knowledge_nodes (account_id, id),
      FOREIGN KEY (account_id, source_id) REFERENCES knowledge_sources (account_id, id),
      CHECK (kind = 'page' OR body = ''),
      CHECK (status <> 'published' OR published_at IS NOT NULL),
      UNIQUE (account_id, id)
    )
  `.execute(db);
  await sql`
    CREATE INDEX knowledge_nodes_tree_idx ON knowledge_nodes (project_id, parent_id, position)
  `.execute(db);
  await sql`
    CREATE INDEX knowledge_nodes_search_idx ON knowledge_nodes (project_id, status, updated_at DESC)
  `.execute(db);
  await sql`
    CREATE INDEX knowledge_nodes_title_trgm_idx ON knowledge_nodes USING gin (title gin_trgm_ops)
  `.execute(db);

  // A node cannot become its own ancestor; the check runs in the database, not only in code.
  await sql`
    CREATE FUNCTION knowledge_node_guard_cycle() RETURNS trigger
      LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
    DECLARE
      cursor uuid := NEW.parent_id;
      depth integer := 0;
    BEGIN
      WHILE cursor IS NOT NULL LOOP
        IF cursor = NEW.id THEN
          RAISE EXCEPTION 'knowledge node cycle' USING ERRCODE = 'check_violation';
        END IF;
        depth := depth + 1;
        IF depth > 64 THEN
          RAISE EXCEPTION 'knowledge node tree is too deep' USING ERRCODE = 'check_violation';
        END IF;
        SELECT parent_id INTO cursor FROM knowledge_nodes
          WHERE account_id = NEW.account_id AND id = cursor;
      END LOOP;
      RETURN NEW;
    END
    $$
  `.execute(db);
  await sql`
    CREATE TRIGGER knowledge_nodes_guard_cycle
      BEFORE INSERT OR UPDATE OF parent_id ON knowledge_nodes
      FOR EACH ROW EXECUTE FUNCTION knowledge_node_guard_cycle()
  `.execute(db);

  await sql`
    CREATE TABLE knowledge_revisions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      node_id uuid NOT NULL,
      revision integer NOT NULL CHECK (revision > 0),
      title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
      body text NOT NULL,
      status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
      author_id uuid REFERENCES users (id),
      author_kind text NOT NULL DEFAULT 'user' CHECK (author_kind IN ('user', 'agent', 'system')),
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (account_id, node_id) REFERENCES knowledge_nodes (account_id, id),
      UNIQUE (node_id, revision)
    )
  `.execute(db);

  await sql`
    CREATE TABLE knowledge_citations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      node_id uuid NOT NULL,
      source_id uuid NOT NULL,
      -- {"section": "2.1", "charStart": 1200, "charEnd": 2040} or {"sheet": "Метрики", "row": 12}
      locator jsonb NOT NULL DEFAULT '{}',
      quote text CHECK (length(quote) <= 1000),
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (account_id, node_id) REFERENCES knowledge_nodes (account_id, id),
      FOREIGN KEY (account_id, source_id) REFERENCES knowledge_sources (account_id, id)
    )
  `.execute(db);
  await sql`CREATE INDEX knowledge_citations_node_idx ON knowledge_citations (node_id)`.execute(db);

  await sql`
    CREATE TABLE knowledge_chunks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      project_id uuid NOT NULL,
      node_id uuid NOT NULL,
      position integer NOT NULL CHECK (position >= 0),
      heading_path text[] NOT NULL DEFAULT '{}',
      text text NOT NULL CHECK (length(text) BETWEEN 1 AND 4000),
      token_count integer NOT NULL DEFAULT 0 CHECK (token_count >= 0),
      content_hash text NOT NULL,
      tsv tsvector GENERATED ALWAYS AS (to_tsvector('russian', text)) STORED,
      embedding vector(1536),
      embedding_model text,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (account_id, node_id) REFERENCES knowledge_nodes (account_id, id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, project_id) REFERENCES projects (account_id, id) ON DELETE CASCADE,
      UNIQUE (node_id, position)
    )
  `.execute(db);
  await sql`CREATE INDEX knowledge_chunks_tsv_idx ON knowledge_chunks USING gin (tsv)`.execute(db);
  await sql`
    CREATE INDEX knowledge_chunks_embedding_idx ON knowledge_chunks
      USING hnsw (embedding vector_cosine_ops)
  `.execute(db);
  await sql`CREATE INDEX knowledge_chunks_node_idx ON knowledge_chunks (project_id, node_id)`.execute(db);

  await sql`
    CREATE TABLE knowledge_proposals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      project_id uuid NOT NULL,
      agent_id uuid NOT NULL,
      kind text NOT NULL CHECK (kind IN ('create', 'edit', 'gap')),
      payload jsonb NOT NULL DEFAULT '{}',
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected')),
      resolved_by uuid REFERENCES users (id),
      resolved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (account_id, project_id) REFERENCES projects (account_id, id) ON DELETE CASCADE,
      FOREIGN KEY (account_id, agent_id) REFERENCES agents (account_id, id) ON DELETE CASCADE,
      CHECK (status = 'open' OR resolved_at IS NOT NULL)
    )
  `.execute(db);
  await sql`
    CREATE INDEX knowledge_proposals_queue_idx ON knowledge_proposals (project_id, status, created_at DESC)
  `.execute(db);

  for (const table of TABLES) {
    await enableAccountRls(db, table);
  }
  await sql`
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      knowledge_sources, knowledge_nodes, knowledge_revisions, knowledge_citations,
      knowledge_chunks, knowledge_proposals
    TO ${sql.id(app)}
  `.execute(db);
  // The index sweep walks unpublished-by-hash pages of every account by id and timestamp only.
  await sql`
    GRANT SELECT (id, account_id, project_id, status, content_hash, updated_at) ON knowledge_nodes
    TO ${sql.id(system)}
  `.execute(db);
  await sql`GRANT SELECT (id, account_id, project_id, status) ON knowledge_sources TO ${sql.id(system)}`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE knowledge_proposals`.execute(db);
  await sql`DROP TABLE knowledge_chunks`.execute(db);
  await sql`DROP TABLE knowledge_citations`.execute(db);
  await sql`DROP TABLE knowledge_revisions`.execute(db);
  await sql`DROP TRIGGER knowledge_nodes_guard_cycle ON knowledge_nodes`.execute(db);
  await sql`DROP TABLE knowledge_nodes`.execute(db);
  await sql`DROP FUNCTION knowledge_node_guard_cycle()`.execute(db);
  await sql`DROP TABLE knowledge_sources`.execute(db);
  // Extensions stay: other schemas may use them and dropping vector is not reversible data-wise.
}
