import { Injectable } from '@nestjs/common';

import { AccountDb, type AccountTx } from '../../database/scoped-db.js';
import { JournalService } from '../../journal/journal.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { ScheduledTasksService } from '../../scheduling/scheduled-tasks.service.js';
import { CatalogService, versionMode, versionToolIds } from '../catalog/catalog.service.js';
import { type ProjectActor, ProjectContext } from '../projects/project-context.js';
import { type AgentConnectionInput, AgentHiring, type CustomAgentInput } from './agent-hiring.js';
import { AGENT_ERRORS, AgentException } from './agents.errors.js';
import {
  ASKS,
  findTool,
  LIMIT_KINDS,
  type LimitKind,
  type LimitValue,
  type PermissionMode,
  type RiskClass,
  TOOLS,
} from './catalog/catalog.js';
import { type AgentSummaryDto, AgentTemplateSummaryDto } from './dto/agent.dto.js';
import { AGENT_EVENTS, AGENT_TASKS, type AgentEvent } from './events/agent.events.js';
import {
  type AgentConnectionView,
  type AgentRow,
  AgentsRepository,
  type AgentUpdate,
  type Instruction,
} from './repositories/agents.repository.js';

export interface EffectivePermission {
  actionId: string;
  risk: RiskClass;
  mode: PermissionMode;
  source: 'preset' | 'explicit' | 'system';
  locked: boolean;
}

export interface AgentDetails {
  agent: AgentRow;
  connections: AgentConnectionView[];
  permissions: EffectivePermission[];
  notes: Array<{ id: string; text: string; created_at: Date }>;
  enforcedAsks: string[];
  template: AgentTemplateSummaryDto | null;
}

const QUIET_HOURS = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
const GLYPH = /^[a-z_]{2,30}$/;
const BG = /^[a-z0-9-]{1,30}$/;

@Injectable()
export class AgentsService {
  constructor(
    private readonly accountDb: AccountDb,
    private readonly agents: AgentsRepository,
    private readonly hiring: AgentHiring,
    private readonly journal: JournalService,
    private readonly outbox: OutboxService,
    private readonly tasks: ScheduledTasksService,
    private readonly projectContext: ProjectContext,
    private readonly catalog: CatalogService,
  ) {}

  /** Team of the project with each agent's connections and 7-day summary (sidebar, /agents, /tasks). */
  list(): Promise<Array<{ agent: AgentRow; connections: AgentConnectionView[]; summary: AgentSummaryDto }>> {
    const { projectId } = this.projectContext.actor();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.accountDb.transaction(async (tx) => {
      const agents = await this.agents.list(tx.db, projectId);
      const agentIds = agents.map((a) => a.id);
      const [links, toolRows, taskRows, decisionRows] = await Promise.all([
        this.agents.listConnections(tx.db, agentIds),
        tx.db
          .selectFrom('tool_calls')
          .select([
            'agent_id',
            (eb) => eb.fn.countAll<string>().as('cnt'),
            (eb) => eb.fn.max('created_at').as('last_at'),
          ])
          .where('project_id', '=', projectId)
          .where('tool_id', 'like', '%.%')
          .where('created_at', '>', weekAgo)
          .groupBy('agent_id')
          .execute(),
        tx.db
          .selectFrom('tasks')
          .select(['agent_id', 'status', 'updated_at'])
          .where('project_id', '=', projectId)
          .execute(),
        tx.db
          .selectFrom('decisions')
          .select(['agent_id', 'status'])
          .where('project_id', '=', projectId)
          .where('status', 'in', ['accepted', 'modified', 'rejected', 'expired'])
          .execute(),
      ]);

      const toolByAgent = new Map(
        toolRows.map((r) => [r.agent_id, { count: Number(r.cnt), lastAt: r.last_at as Date | null }]),
      );

      const tasksByAgent = new Map<string, { active: number; done: number; lastAt: Date | null }>();
      for (const t of taskRows) {
        const entry = tasksByAgent.get(t.agent_id) ?? { active: 0, done: 0, lastAt: null };
        if (t.status === 'done') entry.done++;
        else if (t.status !== 'cancelled') entry.active++;
        if (!entry.lastAt || t.updated_at > entry.lastAt) entry.lastAt = t.updated_at;
        tasksByAgent.set(t.agent_id, entry);
      }

      const decByAgent = new Map<string, { accepted: number; total: number }>();
      for (const d of decisionRows) {
        const entry = decByAgent.get(d.agent_id) ?? { accepted: 0, total: 0 };
        entry.total++;
        if (d.status === 'accepted' || d.status === 'modified') entry.accepted++;
        decByAgent.set(d.agent_id, entry);
      }

      return agents.map((agent) => {
        const tools = toolByAgent.get(agent.id);
        const tasks = tasksByAgent.get(agent.id);
        const decs = decByAgent.get(agent.id);
        const lastCandidates = [tools?.lastAt, tasks?.lastAt].filter((d): d is Date => Boolean(d));
        const lastActionAt =
          lastCandidates.length > 0 ? lastCandidates.reduce((a, b) => (a > b ? a : b)) : null;
        return {
          agent,
          connections: links.filter((link) => link.agentId === agent.id),
          summary: {
            actionsWeek: tools?.count ?? 0,
            tasksActive: tasks?.active ?? 0,
            tasksDone: tasks?.done ?? 0,
            lastActionAt,
            acceptedPct: decs && decs.total > 0 ? Math.round((decs.accepted / decs.total) * 100) : null,
          },
        };
      });
    });
  }

  async get(id: string): Promise<AgentDetails> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction((tx) => this.details(tx, actor.projectId, id));
  }

  hire(input: {
    templateKey?: string;
    custom?: CustomAgentInput;
    connections: AgentConnectionInput[];
    trustLevel?: string;
  }): Promise<AgentDetails> {
    const actor = this.projectContext.actor();
    if (input.custom) this.assertIcon(input.custom.icon);
    return this.accountDb.transaction(async (tx) => {
      const agent = await this.hiring.hire(tx, {
        projectId: actor.projectId,
        templateKey: input.custom ? undefined : input.templateKey,
        custom: input.custom,
        connections: input.connections,
        trustLevel: input.trustLevel,
        strictRequirements: true,
        actor: { userId: actor.userId, role: actor.role },
      });
      return this.details(tx, actor.projectId, agent.id);
    });
  }

  /** Name, role line, icon, trust (admin): «Агенты: … доверие» in the role matrix. */
  update(
    id: string,
    input: {
      displayName?: string;
      roleText?: string | null;
      icon?: { kind: 'glyph' | 'emoji'; value: string; bg?: string | null };
      trustLevel?: string;
    },
  ): Promise<AgentDetails> {
    if (input.icon) this.assertIcon(input.icon);
    const values: AgentUpdate = {
      ...(input.displayName ? { display_name: input.displayName } : {}),
      ...(input.roleText !== undefined ? { role_text: input.roleText } : {}),
      ...(input.icon
        ? {
            icon_kind: input.icon.kind,
            icon_value: input.icon.value,
            icon_bg: input.icon.bg ?? null,
          }
        : {}),
      ...(input.trustLevel ? { trust_level: input.trustLevel } : {}),
    };
    return this.change(id, 'agents.update', AGENT_EVENTS.UPDATED, values, input, {
      allowManager: true,
    });
  }

  /** Instructions, limits and «always ask» (tech and above). */
  updateRules(
    id: string,
    input: { instructions?: Instruction[]; limits?: Record<string, LimitValue>; asks?: string[] },
  ): Promise<AgentDetails> {
    const values: AgentUpdate = {
      ...(input.instructions ? { instructions: input.instructions } : {}),
      ...(input.limits ? { limits: this.validLimits(input.limits) } : {}),
      ...(input.asks ? { asks: this.validAsks(input.asks) } : {}),
    };
    return this.change(id, 'agents.rules.update', AGENT_EVENTS.RULES_UPDATED, values, {
      instructions: input.instructions?.length,
      limits: input.limits,
      asks: input.asks,
    });
  }

  /** Explicit modes per tool; `mode: null` returns the tool to the trust preset. */
  setPermissions(
    id: string,
    items: Array<{ actionId: string; mode: PermissionMode | null }>,
  ): Promise<AgentDetails> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const agent = await this.mustFind(tx, actor.projectId, id);
      const tools = this.toolsOf(agent);
      for (const item of items) {
        const tool = findTool(item.actionId);
        if (!tool || !tools.includes(item.actionId)) {
          throw new AgentException(AGENT_ERRORS.AGENT_TOOL_UNKNOWN, {
            messageArgs: { action: item.actionId },
          });
        }
        if (tool.systemDenied) {
          throw new AgentException(AGENT_ERRORS.AGENT_PERMISSION_LOCKED);
        }
        await this.agents.setPermission(tx.db, {
          account_id: tx.accountId,
          agent_id: id,
          action_id: item.actionId,
          mode: item.mode,
          updated_by: actor.userId,
        });
      }
      await this.record(tx, actor, id, 'agents.permissions.update', { items });
      await this.event(tx, AGENT_EVENTS.PERMISSIONS_UPDATED, actor, id);
      return this.details(tx, actor.projectId, id);
    });
  }

  /** E13: which connections the agent uses and at what level. */
  setConnections(id: string, items: AgentConnectionInput[]): Promise<AgentDetails> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const agent = await this.mustFind(tx, actor.projectId, id, { allowManager: false });
      const connections = await this.hiring.validateConnections(tx, actor.projectId, items);
      const template = this.versionOf(agent);
      if (template) this.hiring.assertRequirements(template, connections);
      await this.agents.replaceConnections(tx.db, tx.accountId, id, items);
      await this.record(tx, actor, id, 'agents.connections.update', {
        connections: items.map((item) => ({ id: item.connectionId, access: item.accessLevel })),
      });
      await this.event(tx, AGENT_EVENTS.CONNECTIONS_UPDATED, actor, id);
      return this.details(tx, actor.projectId, id);
    });
  }

  pause(id: string, until?: Date): Promise<AgentDetails> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      await this.mustFind(tx, actor.projectId, id, { allowManager: false });
      await this.agents.update(tx.db, id, { status: 'paused', paused_until: until ?? null });
      if (until) {
        await this.tasks.schedule(tx, {
          type: AGENT_TASKS.RESUME,
          payload: { agentId: id, until: until.toISOString() },
          runAt: until,
          dedupeKey: `${id}:${until.toISOString()}`,
        });
      }
      await this.record(tx, actor, id, 'agents.pause', { until: until?.toISOString() ?? null });
      await this.event(tx, AGENT_EVENTS.PAUSED, actor, id);
      return this.details(tx, actor.projectId, id);
    });
  }

  resume(id: string): Promise<AgentDetails> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const agent = await this.mustFind(tx, actor.projectId, id, { allowManager: false });
      const onProbation = agent.probation_until !== null && agent.probation_until.getTime() > Date.now();
      await this.agents.update(tx.db, id, {
        status: onProbation ? 'probation' : 'active',
        paused_until: null,
      });
      await this.record(tx, actor, id, 'agents.resume', {});
      await this.event(tx, AGENT_EVENTS.RESUMED, actor, id);
      return this.details(tx, actor.projectId, id);
    });
  }

  /** «Отключить агента»: tasks stop, the history stays. */
  fire(id: string): Promise<void> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const agent = await this.mustFind(tx, actor.projectId, id, { allowManager: false });
      await this.agents.softDelete(tx.db, id);
      await this.record(tx, actor, id, 'agents.fire', {
        template: agent.template_key,
        name: agent.display_name,
      });
      await this.event(tx, AGENT_EVENTS.FIRED, actor, id);
    });
  }

  deleteNote(id: string, noteId: string): Promise<void> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      await this.mustFind(tx, actor.projectId, id, { allowManager: true });
      if (!(await this.agents.deleteNote(tx.db, id, noteId))) {
        throw new AgentException(AGENT_ERRORS.AGENT_NOT_FOUND);
      }
      await this.record(tx, actor, id, 'agents.note.delete', { noteId });
    });
  }

  // --- internals ----------------------------------------------------------------------------

  private async change(
    id: string,
    action: string,
    event: string,
    values: AgentUpdate,
    args: unknown,
    options: { allowManager?: boolean } = {},
  ): Promise<AgentDetails> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      await this.mustFind(tx, actor.projectId, id, { allowManager: options.allowManager ?? true });
      if (Object.keys(values).length > 0) {
        await this.agents.update(tx.db, id, values);
        await this.record(tx, actor, id, action, args);
        await this.event(tx, event, actor, id);
      }
      return this.details(tx, actor.projectId, id);
    });
  }

  private async details(tx: AccountTx, projectId: string, id: string): Promise<AgentDetails> {
    const agent = await this.mustFind(tx, projectId, id, { allowManager: true });
    const [connections, explicit, notes, project] = await Promise.all([
      this.agents.listConnections(tx.db, [id]),
      this.agents.listPermissions(tx.db, id),
      this.agents.listNotes(tx.db, id),
      tx.db.selectFrom('projects').select('always_ask').where('id', '=', projectId).executeTakeFirstOrThrow(),
    ]);
    const modes = new Map(explicit.map((row) => [row.action_id, row.mode as PermissionMode]));
    const permissions = this.toolsOf(agent).flatMap((actionId): EffectivePermission[] => {
      const tool = findTool(actionId);
      if (!tool) return [];
      if (tool.systemDenied) {
        return [{ actionId, risk: tool.risk, mode: 'deny', source: 'system', locked: true }];
      }
      const own = modes.get(actionId);
      return [
        {
          actionId,
          risk: tool.risk,
          mode: own ?? versionMode(this.versionOf(agent), actionId, agent.trust_level),
          source: own ? 'explicit' : 'preset',
          locked: false,
        },
      ];
    });
    const version = agent.kind === 'manager' ? undefined : this.versionOf(agent);
    return {
      agent,
      connections,
      permissions,
      notes,
      enforcedAsks: project.always_ask.filter((ask) => (ASKS as readonly string[]).includes(ask)),
      template: version ? AgentTemplateSummaryDto.fromVersion(version) : null,
    };
  }

  private versionOf(agent: AgentRow) {
    return this.catalog.forAgent({
      templateKey: agent.template_key,
      templateVersionId: agent.template_version_id,
    });
  }

  /** Tools of the role plus the system-closed ones, shown as «Никогда». */
  private toolsOf(agent: AgentRow): string[] {
    if (agent.kind === 'manager') return [];
    if (!agent.template_key) return agent.custom_tools;
    const version = this.versionOf(agent);
    const denied = TOOLS.filter((tool) => tool.systemDenied).map((tool) => tool.id);
    return [...(version ? versionToolIds(version) : []), ...denied];
  }

  private async mustFind(
    tx: AccountTx,
    projectId: string,
    id: string,
    options: { allowManager?: boolean } = {},
  ): Promise<AgentRow> {
    const agent = await this.agents.find(tx.db, projectId, id);
    if (!agent) throw new AgentException(AGENT_ERRORS.AGENT_NOT_FOUND);
    if (agent.kind === 'manager' && options.allowManager === false) {
      throw new AgentException(AGENT_ERRORS.AGENT_MANAGER_IMMUTABLE);
    }
    return agent;
  }

  private validLimits(limits: Record<string, LimitValue>): Record<string, LimitValue> {
    for (const [kind, value] of Object.entries(limits)) {
      const def = LIMIT_KINDS[kind as LimitKind];
      const ok = !def
        ? false
        : def.unit === 'time_range'
          ? typeof value === 'string' && (value === '' || QUIET_HOURS.test(value))
          : typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= def.max;
      if (!ok) throw new AgentException(AGENT_ERRORS.AGENT_LIMIT_INVALID, { messageArgs: { limit: kind } });
    }
    return limits;
  }

  private validAsks(asks: string[]): string[] {
    const unknown = asks.find((ask) => !(ASKS as readonly string[]).includes(ask));
    if (unknown)
      throw new AgentException(AGENT_ERRORS.AGENT_TOOL_UNKNOWN, {
        messageArgs: { action: unknown },
      });
    return [...new Set(asks)];
  }

  private assertIcon(icon: { kind: string; value: string; bg?: string | null }): void {
    const ok =
      (icon.kind === 'glyph' && GLYPH.test(icon.value)) ||
      (icon.kind === 'emoji' &&
        [...icon.value].length >= 1 &&
        [...icon.value].length <= 8 &&
        !/[\w\s<>]/.test(icon.value));
    if (!ok || (icon.bg != null && !BG.test(icon.bg))) {
      throw new AgentException(AGENT_ERRORS.AGENT_ICON_INVALID);
    }
  }

  private record(
    tx: AccountTx,
    actor: ProjectActor,
    agentId: string,
    action: string,
    args: unknown,
  ): Promise<void> {
    return this.journal.record(tx, {
      actor: { type: 'user', id: actor.userId, role: actor.role },
      action,
      target: { type: 'agent', id: agentId },
      args,
      status: 'succeeded',
    });
  }

  private event(tx: AccountTx, type: string, actor: ProjectActor, agentId: string): Promise<void> {
    return this.outbox.add<AgentEvent>(tx, {
      type,
      payload: { projectId: actor.projectId, agentId, byUserId: actor.userId },
    });
  }
}
