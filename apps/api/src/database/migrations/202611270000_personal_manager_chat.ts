import { type Kysely, sql } from 'kysely';

import type { DB } from '../types.js';

/** Preserve legacy data. A mixed-author history cannot safely be assigned to one person. */
export async function up(db: Kysely<DB>): Promise<void> {
  await sql`ALTER TABLE conversations
    ADD COLUMN manager_thread boolean NOT NULL DEFAULT false,
    ADD COLUMN private_archive boolean NOT NULL DEFAULT false,
    ADD COLUMN merged_into uuid REFERENCES conversations (id) ON DELETE SET NULL`.execute(db);
  await sql`ALTER TABLE messages ADD COLUMN notification_event_id uuid,
    ADD COLUMN notification_kind text CHECK (notification_kind IN
      ('decision_accepted', 'team_paused', 'team_resumed', 'rules_changed', 'budget_changed', 'connections_disconnected')),
    ADD CONSTRAINT messages_notification_complete CHECK
      ((notification_event_id IS NULL AND notification_kind IS NULL)
       OR (notification_event_id IS NOT NULL AND notification_kind IS NOT NULL AND role = 'system'))`.execute(
    db,
  );

  // The migration owner needs to read every tenant while classifying historical conversations.
  for (const table of ['conversations', 'messages', 'agents', 'tasks']) {
    await sql`ALTER TABLE ${sql.id(table)} NO FORCE ROW LEVEL SECURITY`.execute(db);
  }
  await sql`UPDATE conversations c SET private_archive = true
    WHERE c.created_by IS NULL OR EXISTS (
      SELECT 1 FROM messages m WHERE m.conversation_id = c.id
        AND m.role = 'user' AND m.author_user_id IS DISTINCT FROM c.created_by
    )`.execute(db);
  await sql`CREATE TEMP TABLE manager_chat_merge ON COMMIT DROP AS
    SELECT c.id, first_value(c.id) OVER (
      PARTITION BY c.project_id, c.created_by
      ORDER BY (c.title IS NULL), c.created_at, c.id
    ) AS canonical
    FROM conversations c JOIN agents a ON a.id = c.agent_id
    WHERE a.kind = 'manager' AND NOT c.private_archive`.execute(db);
  await sql`UPDATE messages m SET conversation_id = map.canonical
    FROM manager_chat_merge map WHERE m.conversation_id = map.id AND map.id <> map.canonical`.execute(db);
  await sql`UPDATE tasks t SET conversation_id = map.canonical
    FROM manager_chat_merge map WHERE t.conversation_id = map.id AND map.id <> map.canonical`.execute(db);
  await sql`UPDATE conversations c SET private_archive = true, merged_into = map.canonical
    FROM manager_chat_merge map WHERE c.id = map.id AND map.id <> map.canonical`.execute(db);
  await sql`UPDATE conversations c SET manager_thread = true,
    last_message_at = greatest(c.last_message_at,
      (SELECT max(m.created_at) FROM messages m WHERE m.conversation_id = c.id))
    WHERE c.id IN (SELECT canonical FROM manager_chat_merge)`.execute(db);
  for (const table of ['conversations', 'messages', 'agents', 'tasks']) {
    await sql`ALTER TABLE ${sql.id(table)} FORCE ROW LEVEL SECURITY`.execute(db);
  }
  await sql`ALTER TABLE conversations ADD CONSTRAINT conversation_personal_owner
    CHECK (NOT manager_thread OR (created_by IS NOT NULL AND NOT private_archive))`.execute(db);
  await sql`CREATE UNIQUE INDEX conversations_personal_manager_idx ON conversations (project_id, created_by)
    WHERE manager_thread`.execute(db);
  await sql`CREATE UNIQUE INDEX messages_notification_once_idx ON messages (conversation_id, notification_event_id, notification_kind)`.execute(
    db,
  );
}
