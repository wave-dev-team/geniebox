import { type Kysely, sql } from 'kysely';

/**
 * Inter-agent task tree and delegation metadata:
 * - tasks.parent_task_id: links subtasks to their parent task
 * - tasks.assigned_by_agent_id: which agent delegated the task
 * - tasks.waiting_reason: 'decision' | 'subtasks' | 'connection'
 * - routines.assigned_by_agent_id: which agent created the routine
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE tasks
      ADD COLUMN parent_task_id uuid,
      ADD COLUMN assigned_by_agent_id uuid,
      ADD COLUMN waiting_reason text CHECK (waiting_reason IN ('decision', 'subtasks', 'connection')),
      ADD CONSTRAINT tasks_parent_task_fk
        FOREIGN KEY (account_id, parent_task_id) REFERENCES tasks (account_id, id)
        ON DELETE SET NULL (parent_task_id),
      ADD CONSTRAINT tasks_assigned_by_agent_fk
        FOREIGN KEY (account_id, assigned_by_agent_id) REFERENCES agents (account_id, id)
        ON DELETE SET NULL (assigned_by_agent_id)
  `.execute(db);

  await sql`
    CREATE INDEX tasks_parent_idx ON tasks (project_id, parent_task_id)
      WHERE parent_task_id IS NOT NULL
  `.execute(db);

  await sql`
    ALTER TABLE routines
      ADD COLUMN assigned_by_agent_id uuid,
      ADD CONSTRAINT routines_assigned_by_agent_fk
        FOREIGN KEY (account_id, assigned_by_agent_id) REFERENCES agents (account_id, id)
        ON DELETE SET NULL (assigned_by_agent_id)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE routines
      DROP CONSTRAINT IF EXISTS routines_assigned_by_agent_fk,
      DROP COLUMN IF EXISTS assigned_by_agent_id
  `.execute(db);

  await sql`DROP INDEX IF EXISTS tasks_parent_idx`.execute(db);

  await sql`
    ALTER TABLE tasks
      DROP CONSTRAINT IF EXISTS tasks_assigned_by_agent_fk,
      DROP CONSTRAINT IF EXISTS tasks_parent_task_fk,
      DROP COLUMN IF EXISTS waiting_reason,
      DROP COLUMN IF EXISTS assigned_by_agent_id,
      DROP COLUMN IF EXISTS parent_task_id
  `.execute(db);
}
