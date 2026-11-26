import { type Kysely, sql } from 'kysely';

/**
 * Onboarding step «Команда» offers catalog agents marked in their version instead of a list
 * in the app. The five agents it offered so far keep their place and the goals that made
 * them «Рекомендуем»; the analyst fits every goal.
 */
const OFFERED: Record<string, string[]> = {
  support: ['faster_support'],
  analyst: ['more_clients', 'less_churn', 'faster_support', 'less_routine', 'tech_order'],
  marketer: ['more_clients', 'less_churn'],
  engineer: ['tech_order'],
  content: ['less_routine'],
};

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const [key, goals] of Object.entries(OFFERED)) {
    await sql`
      UPDATE agent_template_versions v
      SET content = jsonb_set(v.content, '{onboarding}',
                              jsonb_build_object('offered', true, 'goals', ${JSON.stringify(goals)}::jsonb))
      FROM agent_templates t
      WHERE t.id = v.template_id AND t.key = ${key} AND v.state IN ('published', 'draft')
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`UPDATE agent_template_versions SET content = content - 'onboarding'`.execute(db);
}
