import { sql, type Transaction } from 'kysely';

import type { DB } from '../../database/types.js';
import { inRollout } from './catalog-checks.js';

/** Gradual update of projects: 10% now, 50% a day later, everyone two days later. */
export const ROLLOUT_STAGES = [10, 50, 100] as const;
export const ROLLOUT_STEP_MS = 24 * 60 * 60 * 1000;

export interface Rollout {
  mode: 'now' | 'gradual';
  stage: number;
  nextAt: string | null;
}

/**
 * Moves the template's live agents that are not on `versionId` to it — all of them, or only
 * those inside the first `stage` percent. Runs on the system role (BYPASSRLS): catalog
 * versions are platform data and the pin is the only column it may change on agents.
 */
export async function moveAgents(
  trx: Transaction<DB>,
  templateKey: string,
  versionId: string,
  stage = 100,
): Promise<number> {
  const agents = await trx
    .selectFrom('agents')
    .select(['id'])
    .where('template_key', '=', templateKey)
    .where('kind', '=', 'agent')
    .where('deleted_at', 'is', null)
    .where((eb) => eb.or([eb('template_version_id', 'is', null), eb('template_version_id', '!=', versionId)]))
    .execute();
  const ids = agents.filter((agent) => inRollout(agent.id, stage)).map((agent) => agent.id);
  if (!ids.length) return 0;
  await trx.updateTable('agents').set({ template_version_id: versionId }).where('id', 'in', ids).execute();
  return ids.length;
}

/** Agents per version of a template (version list «N проектов»). */
export async function agentsPerVersion(
  trx: Transaction<DB> | { selectFrom: Transaction<DB>['selectFrom'] },
  templateKey: string,
): Promise<Map<string, number>> {
  const rows = await trx
    .selectFrom('agents')
    .select(['template_version_id', sql<string>`count(*)`.as('count')])
    .where('template_key', '=', templateKey)
    .where('kind', '=', 'agent')
    .where('deleted_at', 'is', null)
    .groupBy('template_version_id')
    .execute();
  return new Map(rows.map((row) => [row.template_version_id ?? '', Number(row.count)]));
}
