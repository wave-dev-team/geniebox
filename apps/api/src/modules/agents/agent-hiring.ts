import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema.js';
import type { AccountTx } from '../../database/scoped-db.js';
import { JournalService } from '../../journal/journal.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { ScheduledTasksService } from '../../scheduling/scheduled-tasks.service.js';
import { CatalogService, type CatalogVersion } from '../catalog/catalog.service.js';
import { requirementTextsFor } from '../catalog/catalog-content.js';
import { AGENT_ERRORS, AgentException } from './agents.errors.js';
import { ASKS, toolsForProviders } from './catalog/catalog.js';
import { AGENT_EVENTS, AGENT_TASKS, type AgentEvent } from './events/agent.events.js';
import { type AgentRow, AgentsRepository, type Instruction } from './repositories/agents.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const LEVEL_RANK: Record<string, number> = { read: 1, read_write: 2 };
/** Lower is stricter: hiring takes the stricter of the project's and the template's default. */
const TRUST_RANK: Record<string, number> = { approve_all: 0, approve_important: 1, autonomous: 2 };

export interface AgentConnectionInput {
  connectionId: string;
  accessLevel: 'read' | 'read_write';
}

export interface CustomAgentInput {
  name: string;
  roleText?: string;
  icon: { kind: 'glyph' | 'emoji'; value: string; bg?: string | null };
  instructions?: string;
}

export interface HireInput {
  projectId: string;
  templateKey?: string;
  custom?: CustomAgentInput;
  connections: AgentConnectionInput[];
  trustLevel?: string;
  /** Onboarding hires what the user picked even if data is still missing. */
  strictRequirements: boolean;
  actor: { userId: string | null; role?: string };
}

interface ProjectFacts {
  default_trust_level: string;
  probation_days: number;
  always_ask: string[];
}

interface ConnectionFacts {
  id: string;
  provider_key: string;
  access_level: string;
}

/**
 * Hiring rules shared by the API (marketplace) and the worker (onboarding): requirements,
 * starting trust and probation, default asks and limits, connections, journal and events.
 */
@Injectable()
export class AgentHiring {
  private readonly maxAgents: number;

  constructor(
    private readonly agents: AgentsRepository,
    private readonly journal: JournalService,
    private readonly outbox: OutboxService,
    private readonly tasks: ScheduledTasksService,
    private readonly catalog: CatalogService,
    config: ConfigService<Env, true>,
  ) {
    this.maxAgents = config.get('MAX_AGENTS_PER_PROJECT', { infer: true });
  }

  async hire(tx: AccountTx, input: HireInput): Promise<AgentRow> {
    const project = await this.project(tx, input.projectId);
    if ((await this.agents.countHired(tx.db, input.projectId)) >= this.maxAgents) {
      throw new AgentException(AGENT_ERRORS.AGENT_LIMIT_REACHED, {
        messageArgs: { limit: this.maxAgents },
      });
    }
    // Only what the account's marketplace lists: published for all, or a beta it is in.
    const template =
      input.templateKey && this.catalog.listedFor(input.templateKey, tx.accountId)
        ? this.catalog.published(input.templateKey)
        : undefined;
    if (input.templateKey && !template) {
      throw new AgentException(AGENT_ERRORS.AGENT_TEMPLATE_UNKNOWN);
    }
    const content = template?.content;
    if (template && (await this.agents.templateHired(tx.db, input.projectId, template.key))) {
      throw new AgentException(AGENT_ERRORS.AGENT_ALREADY_HIRED);
    }
    const connections = await this.validateConnections(tx, input.projectId, input.connections);
    if (template && input.strictRequirements) {
      this.assertRequirements(template, connections);
    }

    const enforced = project.always_ask.filter((ask) => (ASKS as readonly string[]).includes(ask));
    const now = Date.now();
    const probationUntil = new Date(now + project.probation_days * DAY_MS);
    const agent = await this.agents.insert(tx.db, {
      account_id: tx.accountId,
      project_id: input.projectId,
      kind: 'agent',
      template_key: template?.key ?? null,
      template_version_id: template?.versionId ?? null,
      display_name: input.custom?.name ?? template?.key ?? 'agent',
      role_text: input.custom?.roleText ?? null,
      icon_kind: input.custom?.icon.kind ?? 'glyph',
      icon_value: input.custom?.icon.value ?? template?.icon ?? 'bot',
      icon_bg: input.custom?.icon.bg ?? null,
      status: 'probation',
      probation_until: probationUntil,
      trust_level: input.trustLevel ?? stricterTrust(project.default_trust_level, content?.defaultTrust),
      asks: [...new Set([...(content?.asks.defaults ?? []), ...enforced])],
      limits: content ? { ...content.limits } : { ai_budget_monthly: 1500 },
      instructions: input.custom?.instructions?.trim()
        ? [
            {
              topic: 'general',
              rule: input.custom.instructions.trim().slice(0, 500),
            } satisfies Instruction,
          ]
        : [],
      custom_tools: template ? [] : toolsForProviders(connections.map((c) => c.provider_key)),
      hired_by: input.actor.userId,
    });
    await this.agents.replaceConnections(tx.db, tx.accountId, agent.id, input.connections);
    await this.tasks.schedule(tx, {
      type: AGENT_TASKS.PROBATION_END,
      payload: { agentId: agent.id },
      runAt: probationUntil,
      dedupeKey: agent.id,
    });
    await this.journal.record(tx, {
      actor: input.actor.userId
        ? { type: 'user', id: input.actor.userId, role: input.actor.role }
        : { type: 'system', id: 'onboarding' },
      action: 'agents.hire',
      target: { type: 'agent', id: agent.id },
      args: {
        template: template?.key ?? null,
        custom: Boolean(input.custom),
        connections: input.connections.length,
        trustLevel: agent.trust_level,
      },
      status: 'succeeded',
    });
    await this.outbox.add<AgentEvent>(tx, {
      type: AGENT_EVENTS.HIRED,
      payload: { projectId: input.projectId, agentId: agent.id, byUserId: input.actor.userId },
    });
    return agent;
  }

  /** Connections must be live in this project; the agent's access cannot exceed theirs. */
  async validateConnections(
    tx: AccountTx,
    projectId: string,
    items: AgentConnectionInput[],
  ): Promise<ConnectionFacts[]> {
    if (items.length === 0) return [];
    const ids = [...new Set(items.map((item) => item.connectionId))];
    if (ids.length !== items.length) {
      throw new AgentException(AGENT_ERRORS.AGENT_CONNECTION_INVALID);
    }
    const rows = await tx.db
      .selectFrom('connections')
      .select(['id', 'provider_key', 'access_level'])
      .where('project_id', '=', projectId)
      .where('deleted_at', 'is', null)
      .where('id', 'in', ids)
      .execute();
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const item of items) {
      const row = byId.get(item.connectionId);
      if (!row || (LEVEL_RANK[item.accessLevel] ?? 9) > (LEVEL_RANK[row.access_level] ?? 0)) {
        throw new AgentException(AGENT_ERRORS.AGENT_CONNECTION_INVALID);
      }
    }
    return rows;
  }

  assertRequirements(template: CatalogVersion, connections: ConnectionFacts[]): void {
    const providers = new Set(connections.map((c) => c.provider_key));
    const missing = template.content.requirements.find(
      (requirement) => requirement.required && !requirement.providers.some((p) => providers.has(p)),
    );
    if (missing) {
      throw new AgentException(AGENT_ERRORS.AGENT_REQUIREMENTS_MISSING, {
        messageArgs: { requirement: requirementTextsFor(missing, 'ru').title },
        details: { requirement: missing.key },
      });
    }
  }

  /** For onboarding: attach existing connections that satisfy the template's requirements. */
  async matchingConnections(
    tx: AccountTx,
    projectId: string,
    template: CatalogVersion,
  ): Promise<AgentConnectionInput[]> {
    const rows = await tx.db
      .selectFrom('connections')
      .select(['id', 'provider_key'])
      .where('project_id', '=', projectId)
      .where('deleted_at', 'is', null)
      .orderBy('created_at')
      .execute();
    const result: AgentConnectionInput[] = [];
    for (const requirement of template.content.requirements) {
      const match = rows.find(
        (row) =>
          requirement.providers.includes(row.provider_key) && !result.some((r) => r.connectionId === row.id),
      );
      if (match) result.push({ connectionId: match.id, accessLevel: 'read' });
    }
    return result;
  }

  private async project(tx: AccountTx, projectId: string): Promise<ProjectFacts> {
    const row = await tx.db
      .selectFrom('projects')
      .select(['default_trust_level', 'probation_days', 'always_ask'])
      .where('id', '=', projectId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw new AgentException(AGENT_ERRORS.AGENT_NOT_FOUND);
    return row;
  }
}

function stricterTrust(project: string, template: string | undefined): string {
  if (!template) return project;
  return (TRUST_RANK[template] ?? 0) < (TRUST_RANK[project] ?? 0) ? template : project;
}
