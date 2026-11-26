import type { Transaction } from 'kysely';

import type { DB } from '../../database/types.js';

export interface WorkAgent {
  id: string;
  kind: string;
  status: string;
  template_key: string | null;
  display_name: string;
}

/** Live agent of the project (the manager included) or undefined. */
export function findProjectAgent(
  db: Transaction<DB>,
  projectId: string,
  agentId: string,
): Promise<WorkAgent | undefined> {
  return db
    .selectFrom('agents')
    .select(['id', 'kind', 'status', 'template_key', 'display_name'])
    .where('id', '=', agentId)
    .where('project_id', '=', projectId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
}

export function findManager(db: Transaction<DB>, projectId: string): Promise<WorkAgent | undefined> {
  return db
    .selectFrom('agents')
    .select(['id', 'kind', 'status', 'template_key', 'display_name'])
    .where('project_id', '=', projectId)
    .where('kind', '=', 'manager')
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
}
