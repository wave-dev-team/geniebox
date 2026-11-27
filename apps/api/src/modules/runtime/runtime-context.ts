import { sql } from 'kysely';

import { Injectable } from '@nestjs/common';

import { AccountDb } from '../../database/scoped-db.js';
import { readManagerContext } from '../accounts/manager-context.js';
import { agentTitle } from '../agents/catalog/titles.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { textsFor } from '../catalog/catalog-content.js';
import type { RuntimeAgent } from './broker/broker.types.js';
import type { AgentBrief, ProjectBrief, TeamMember } from './prompts/prompts.js';

export interface RuntimeProject {
  id: string;
  brief: ProjectBrief;
  timezone: string;
  aiBudgetRub: number;
  paused: boolean;
}

export interface LoadedAgent {
  runtime: RuntimeAgent;
  brief: AgentBrief;
  deleted: boolean;
}

/** Reads what prompts and the broker need, inside the current account context. */
@Injectable()
export class RuntimeContextLoader {
  constructor(
    private readonly accountDb: AccountDb,
    private readonly catalog: CatalogService,
  ) {}

  async project(projectId: string): Promise<RuntimeProject | undefined> {
    const row = await this.accountDb.transaction((tx) =>
      tx.db
        .selectFrom('projects')
        .select([
          'id',
          'name',
          'about',
          'goals',
          'main_metric',
          'custom_metric',
          'currency',
          'timezone',
          'client_tone',
          'agent_rules',
          'ai_budget_monthly',
          'agents_paused',
          'deleted_at',
        ])
        .where('id', '=', projectId)
        .executeTakeFirst(),
    );
    if (!row || row.deleted_at) return undefined;
    return {
      id: row.id,
      timezone: row.timezone,
      aiBudgetRub: row.ai_budget_monthly,
      paused: row.agents_paused,
      brief: {
        name: row.name,
        about: row.about,
        goals: row.goals,
        mainMetric: row.main_metric === 'custom' ? (row.custom_metric ?? 'custom') : row.main_metric,
        currency: row.currency,
        timezone: row.timezone,
        clientTone: row.client_tone,
        rules: row.agent_rules,
      },
    };
  }

  async managerState(projectId: string, userId: string) {
    return this.accountDb.transaction(async (tx) => {
      const member = await readManagerContext(tx.db, tx.accountId, userId);
      if (!member) return undefined;

      let accepted = tx.db
        .selectFrom('decisions')
        .select(['id', 'title', 'status', 'decided_at', 'task_id'])
        .where('project_id', '=', projectId)
        .where('status', 'in', ['accepted', 'modified']);
      if (member.accountSince) {
        accepted = accepted.where('decided_at', '>', sql<Date>`${member.accountSince}::timestamptz`);
      }
      const decisions = await accepted.orderBy('decided_at', 'desc').limit(12).execute();
      const tasks = await tx.db
        .selectFrom('tasks')
        .select(['id', 'title', 'status'])
        .where('project_id', '=', projectId)
        .where('status', 'in', ['planned', 'running', 'waiting'])
        .orderBy('updated_at', 'desc')
        .limit(12)
        .execute();
      return { role: member.role, historySince: member.historySince, decisions, tasks };
    });
  }

  async agent(agentId: string): Promise<LoadedAgent | undefined> {
    const row = await this.accountDb.transaction((tx) =>
      tx.db.selectFrom('agents').selectAll().where('id', '=', agentId).executeTakeFirst(),
    );
    if (!row) return undefined;
    const limits = (row.limits ?? {}) as Record<string, number | string>;
    const instructions = (row.instructions ?? []) as Array<{ topic: string; rule: string }>;
    const version = this.catalog.forAgent({
      templateKey: row.template_key,
      templateVersionId: row.template_version_id,
    });
    return {
      deleted: row.deleted_at !== null,
      runtime: {
        id: row.id,
        kind: row.kind as 'manager' | 'agent',
        templateKey: row.template_key,
        templateVersionId: row.template_version_id,
        model: version?.content.model ?? 'reasoning',
        catalogTag: version ? `${version.key}@v${version.number}` : null,
        displayName: row.display_name,
        status: row.status,
        trustLevel: row.trust_level,
        asks: row.asks,
        limits,
        customTools: row.custom_tools,
      },
      brief: {
        name: agentTitle(row),
        template: row.template_key,
        rolePrompt: version?.content.prompt.trim() || null,
        role: row.role_text,
        trustLevel: row.trust_level,
        instructions,
        limits,
      },
    };
  }

  async team(projectId: string): Promise<TeamMember[]> {
    const rows = await this.accountDb.transaction((tx) =>
      tx.db
        .selectFrom('agents')
        .select(['id', 'display_name', 'template_key', 'template_version_id', 'role_text', 'status'])
        .where('project_id', '=', projectId)
        .where('kind', '=', 'agent')
        .where('deleted_at', 'is', null)
        .orderBy('hired_at')
        .execute(),
    );
    return rows.map((row) => {
      const version = this.catalog.forAgent({
        templateKey: row.template_key,
        templateVersionId: row.template_version_id,
      });
      return {
        id: row.id,
        name: agentTitle({ ...row, kind: 'agent' }),
        template: row.template_key,
        brief: version ? textsFor(version.content, 'en').short || null : null,
        role: row.role_text,
        status: row.status,
      };
    });
  }

  /** Locale of the person who started the work, for texts written by the platform. */
  async locale(userId: string | null): Promise<string> {
    if (!userId) return 'ru';
    const row = await this.accountDb.transaction((tx) =>
      tx.db.selectFrom('users').select('locale').where('id', '=', userId).executeTakeFirst(),
    );
    return row?.locale ?? 'ru';
  }
}

/** Agent's own monthly AI limit in roubles, if set. */
export function agentBudget(agent: RuntimeAgent): number | null {
  const value = agent.limits.ai_budget_monthly;
  return typeof value === 'number' ? value : null;
}
