import { z } from 'zod';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type AccountRole, ASSIGNABLE_ROLES, hasRoleAtLeast } from '../../common/auth/account-role.js';
import type { Env } from '../../config/env.schema.js';
import { InvitationsService } from '../accounts/invitations.service.js';
import { MembersService } from '../accounts/members.service.js';
import { AgentsService } from '../agents/agents.service.js';
import { ASKS, LIMIT_KINDS, PERMISSION_MODES, SKILLS } from '../agents/catalog/catalog.js';
import { findSkillPlaybook } from '../agents/catalog/skills.js';
import { agentTitle, templateTitle } from '../agents/catalog/titles.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { ConnectionsService } from '../connections/connections.service.js';
import { ActivityService } from '../metrics/activity.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { ResultsService } from '../metrics/results.service.js';
import { ALWAYS_ASK, TRUST_LEVELS } from '../projects/project.constants.js';
import { ProjectsService } from '../projects/projects.service.js';
import { DecisionsService } from '../work/decisions.service.js';
import { RoutinesService } from '../work/routines.service.js';
import { TasksService } from '../work/tasks.service.js';

const id = z.uuid();
const text = (max: number) => z.string().trim().min(1).max(max);
const empty = z.object({}).strict();

/** What an action gives back: a short line for people, compact data for the model. */
export interface ActionResult {
  text: string;
  data?: unknown;
  /** A page or checkout to open (connection form, payment). */
  url?: string;
}

export interface PanelAction<TSchema extends z.ZodObject = z.ZodObject> {
  id: string;
  /** For the model: when to use it. */
  description: string;
  minRole: AccountRole;
  /** Money and decisions are not for tech even though it ranks above viewer. */
  roles?: AccountRole[];
  kind: 'read' | 'write';
  /** A write that only a person's button press may run. */
  confirm: boolean;
  schema: TSchema;
  /** Button label and what it will do, in words (runs as the user, before confirming). */
  describe?: (args: z.infer<TSchema>) => Promise<string>;
  run: (args: z.infer<TSchema>) => Promise<ActionResult>;
}

function define<TSchema extends z.ZodObject>(action: PanelAction<TSchema>): PanelAction {
  return action;
}

const MONEY_ROLES: AccountRole[] = ['owner', 'admin'];

/**
 * What a person can do in the panel, callable outside it (buttons, the manager's panel tools).
 * Every action is a thin wrapper over the same service the API calls and runs
 * inside the user's context (UserActor), so roles, plan limits and the journal are the panel's.
 * Owner-only and destructive account things (project deletion, ownership, sessions) are not
 * here: the bot sends a link to the panel instead.
 */
@Injectable()
export class PanelActions {
  private readonly actions = new Map<string, PanelAction>();
  private readonly appUrl: string;

  constructor(
    private readonly tasks: TasksService,
    private readonly routines: RoutinesService,
    private readonly decisions: DecisionsService,
    private readonly agents: AgentsService,
    private readonly projects: ProjectsService,
    private readonly connections: ConnectionsService,
    private readonly metrics: MetricsService,
    private readonly results: ResultsService,
    private readonly activity: ActivityService,
    private readonly invitations: InvitationsService,
    private readonly members: MembersService,
    private readonly agentCatalog: CatalogService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_PUBLIC_URL', { infer: true });
    for (const action of this.catalog()) this.actions.set(action.id, action);
  }

  get(actionId: string): PanelAction | undefined {
    return this.actions.get(actionId);
  }

  all(): PanelAction[] {
    return [...this.actions.values()];
  }

  allowed(action: PanelAction, role: AccountRole): boolean {
    return action.roles ? action.roles.includes(role) : hasRoleAtLeast(role, action.minRole);
  }

  private agentName = async (agentId: string): Promise<string> => {
    const agent = (await this.agents.get(agentId)).agent;
    return agentTitle(agent);
  };

  private catalog(): PanelAction[] {
    return [
      // --- reading ---------------------------------------------------------------------------
      define({
        id: 'summary',
        description:
          'Project summary for 7/30/90 days: official metrics with change, insight of the day, decisions waiting, what the team did and costs.',
        minRole: 'viewer',
        kind: 'read',
        confirm: false,
        schema: z
          .object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30) })
          .strict(),
        run: async ({ days }) => {
          const summary = await this.results.summary(days);
          return {
            text: 'Сводка',
            data: {
              cards: summary.cards.map((card) => ({
                metric: card.metric.title,
                unit: card.metric.unit,
                value: card.value,
                previous: card.previous,
                trend: card.trend,
              })),
              insight: summary.insight?.text ?? null,
              decisionsWaiting: summary.pendingTotal,
              doneToday: summary.done.length,
              teamCostRub: summary.team.totalRub,
              connections: summary.connections,
            },
          };
        },
      }),
      define({
        id: 'results',
        description: 'What the team brought (confirmed by checks) and costs, ideas with verdicts.',
        minRole: 'viewer',
        kind: 'read',
        confirm: false,
        schema: z
          .object({
            days: z.union([z.literal(30), z.literal(90)]).default(30),
            metricKey: z
              .string()
              .regex(/^[a-z][a-z0-9_]{1,40}$/)
              .optional(),
          })
          .strict(),
        run: async ({ days, metricKey }) => {
          const results = await this.results.resultsFor(days, metricKey);
          return {
            text: 'Результаты',
            data: {
              metric: results.metric?.title ?? null,
              brought: results.brought,
              teamCostRub: results.team.totalRub,
              payback: results.payback,
              worked: results.worked,
              notWorked: results.notWorked,
              ideas: results.ideas.slice(0, 10).map((idea) => ({
                title: idea.title,
                status: idea.status,
                effect: idea.effectValue,
              })),
            },
          };
        },
      }),
      define({
        id: 'journal_today',
        description: 'Actions agents took with the services today (the action journal).',
        minRole: 'tech',
        kind: 'read',
        confirm: false,
        schema: empty,
        run: async () => {
          const page = await this.activity.page({ period: 'today' });
          return {
            text: 'Журнал за сегодня',
            data: page.items.slice(0, 30).map((item) => ({
              at: item.at,
              agentId: item.agentId,
              tool: item.toolId,
              status: item.status,
              details: item.details,
            })),
          };
        },
      }),
      define({
        id: 'list_agents',
        description: 'The team: agents with their status, trust level and limits.',
        minRole: 'viewer',
        kind: 'read',
        confirm: false,
        schema: empty,
        run: async () => ({
          text: 'Команда',
          data: (await this.agents.list()).map(({ agent }) => ({
            id: agent.id,
            name: agentTitle(agent),
            kind: agent.kind,
            template: agent.template_key,
            status: agent.status,
            trustLevel: agent.trust_level,
            limits: agent.limits,
          })),
        }),
      }),
      define({
        id: 'agent_catalog',
        description: 'Available specialist templates: template key, name, data it needs.',
        minRole: 'viewer',
        kind: 'read',
        confirm: false,
        schema: empty,
        run: async () => {
          const hired = new Set(
            (await this.agents.list()).map(({ agent }) => agent.template_key).filter(Boolean),
          );
          return {
            text: 'Доступные специалисты',
            data: this.agentCatalog
              .templates()
              .filter((template) => this.agentCatalog.listedFor(template.key, null))
              .flatMap((template) => {
                const version = this.agentCatalog.published(template.key);
                if (!version) return [];
                return [
                  {
                    templateKey: template.key,
                    name: templateTitle(template.key),
                    requires: version.content.requirements
                      .filter((requirement) => requirement.required)
                      .map((requirement) => requirement.key),
                    hired: hired.has(template.key),
                  },
                ];
              }),
          };
        },
      }),
      define({
        id: 'list_tasks',
        description: 'Tasks in work (active) or finished (done).',
        minRole: 'viewer',
        kind: 'read',
        confirm: false,
        schema: z.object({ tab: z.enum(['active', 'done']).default('active') }).strict(),
        run: async ({ tab }) => ({
          text: 'Задачи',
          data: (await this.tasks.list(tab)).slice(0, 20).map((task) => ({
            id: task.id,
            agentId: task.agentId,
            title: task.title,
            status: task.status,
            progress: task.progressText,
            summary: task.summary,
          })),
        }),
      }),
      define({
        id: 'list_routines',
        description: 'Regular tasks (routines) with schedule and whether they are on.',
        minRole: 'viewer',
        kind: 'read',
        confirm: false,
        schema: empty,
        run: async () => ({
          text: 'Регулярные задачи',
          data: (await this.routines.list()).map((routine) => ({
            id: routine.id,
            agentId: routine.agentId,
            title: routine.title,
            schedule: routine.schedule,
            enabled: routine.enabled,
            nextRunAt: routine.nextRunAt,
          })),
        }),
      }),
      define({
        id: 'list_decisions',
        description: 'Decisions waiting for the owner (pending) or already decided.',
        minRole: 'viewer',
        kind: 'read',
        confirm: false,
        schema: z.object({ tab: z.enum(['pending', 'decided']).default('pending') }).strict(),
        run: async ({ tab }) => ({
          text: 'Решения',
          data: (await this.decisions.list(tab)).slice(0, 20).map((decision) => ({
            id: decision.id,
            agentId: decision.agentId,
            title: decision.title,
            effect: decision.effect,
            cost: decision.cost,
            risk: decision.risk,
            terms: decision.terms,
            status: decision.status,
          })),
        }),
      }),
      define({
        id: 'list_connections',
        description: 'Connected services and their health.',
        minRole: 'tech',
        kind: 'read',
        confirm: false,
        schema: empty,
        run: async () => ({
          text: 'Подключения',
          data: (await this.connections.list()).map(({ connection }) => ({
            id: connection.id,
            name: connection.name,
            provider: connection.provider_key,
            status: connection.status,
            accessLevel: connection.access_level,
            problem: connection.status_reason,
          })),
        }),
      }),
      define({
        id: 'list_metrics',
        description: 'Official metrics of the project and their sources.',
        minRole: 'viewer',
        kind: 'read',
        confirm: false,
        schema: empty,
        run: async () => ({
          text: 'Метрики',
          data: (await this.metrics.list()).map((metric) => ({
            id: metric.id,
            key: metric.key,
            title: metric.title,
            unit: metric.unit,
            pinned: metric.pinned,
            lastError: metric.lastError,
          })),
        }),
      }),
      define({
        id: 'list_members',
        description: 'People of the account and their roles.',
        minRole: 'tech',
        kind: 'read',
        confirm: false,
        schema: empty,
        run: async () => ({
          text: 'Участники',
          data: (await this.members.list()).map((member) => ({
            name: member.displayName ?? member.email,
            role: member.role,
          })),
        }),
      }),

      // --- safe writes, run at once ------------------------------------------------------------
      define({
        id: 'cancel_task',
        description: 'Cancel a task in work.',
        minRole: 'tech',
        kind: 'write',
        confirm: false,
        schema: z.object({ taskId: id }).strict(),
        run: async ({ taskId }) => {
          const task = await this.tasks.cancel(taskId);
          return { text: `Задача «${task.title}» отменена` };
        },
      }),
      define({
        id: 'retry_task',
        description: 'Run a failed or planned task again now.',
        minRole: 'tech',
        kind: 'write',
        confirm: false,
        schema: z.object({ taskId: id }).strict(),
        run: async ({ taskId }) => {
          const task = await this.tasks.run(taskId);
          return { text: `Задача «${task.title}» запущена` };
        },
      }),
      define({
        id: 'run_routine',
        description: 'Run a regular task now.',
        minRole: 'tech',
        kind: 'write',
        confirm: false,
        schema: z.object({ routineId: id }).strict(),
        run: async ({ routineId }) => {
          const task = await this.routines.runNow(routineId);
          return { text: `Запустил «${task.title}»` };
        },
      }),
      define({
        id: 'set_routine_enabled',
        description: 'Turn a regular task on or off.',
        minRole: 'tech',
        kind: 'write',
        confirm: false,
        schema: z.object({ routineId: id, enabled: z.boolean() }).strict(),
        run: async ({ routineId, enabled }) => {
          const routine = await this.routines.update(routineId, { enabled });
          return {
            text: `«${routine.title}» ${enabled ? 'включена' : 'на паузе'}`,
          };
        },
      }),
      define({
        id: 'reject_decision',
        description: 'Say «нет» to a pending decision (nothing outside changes).',
        minRole: 'admin',
        roles: MONEY_ROLES,
        kind: 'write',
        confirm: false,
        schema: z.object({ decisionId: id, reason: text(300).optional() }).strict(),
        run: async ({ decisionId, reason }) => {
          const decision = await this.decisions.reject(decisionId, reason);
          return { text: `Отклонено: «${decision.title}»` };
        },
      }),
      define({
        id: 'pause_agent',
        description: 'Pause an agent: it stops acting until resumed.',
        minRole: 'admin',
        kind: 'write',
        confirm: false,
        schema: z.object({ agentId: id }).strict(),
        run: async ({ agentId }) => {
          const { agent } = await this.agents.pause(agentId);
          return { text: `${agentTitle(agent)} на паузе` };
        },
      }),
      define({
        id: 'pause_team',
        description: 'Pause the whole team of the project: agents only watch.',
        minRole: 'admin',
        kind: 'write',
        confirm: false,
        schema: empty,
        run: async () => {
          await this.projects.pause();
          return { text: 'Команда на паузе: агенты только смотрят' };
        },
      }),
      define({
        id: 'check_connection',
        description: 'Check a connection now.',
        minRole: 'tech',
        kind: 'write',
        confirm: false,
        schema: z.object({ connectionId: id }).strict(),
        run: async ({ connectionId }) => {
          const { view, check } = await this.connections.check(connectionId);
          return {
            text: `${view.connection.name}: ${check?.status === 'error' ? 'ошибка' : 'работает'}`,
            data: { status: view.connection.status, problem: view.connection.status_reason },
          };
        },
      }),
      define({
        id: 'collect_metric',
        description: 'Collect a metric from its source now.',
        minRole: 'admin',
        kind: 'write',
        confirm: false,
        schema: z.object({ metricId: id }).strict(),
        run: async ({ metricId }) => {
          const metric = await this.metrics.collect(metricId);
          return { text: `Собираю «${metric.title}»` };
        },
      }),
      define({
        id: 'connection_link',
        description:
          'A one-time link to the form where the owner or their developer enters the keys of a service (keys never go through chat). providerKey from the providers catalog: yookassa, yandex_metrika, postgres, http_api, telegram_bot, gitlab, grafana, ssh_server. Always use http_api for Jira or any other REST/HTTP service without a dedicated providerKey.',
        minRole: 'tech',
        kind: 'write',
        confirm: false,
        schema: z.object({ providerKey: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/) }).strict(),
        run: async ({ providerKey }) => {
          const link = await this.connections.createLink(providerKey);
          return { text: 'Ссылка на форму подключения', url: link.url };
        },
      }),

      // --- writes a person confirms with a button -------------------------------------------
      define({
        id: 'accept_decision',
        description:
          'Say «да» to a pending decision, optionally with another of its terms (term = option value).',
        minRole: 'admin',
        roles: MONEY_ROLES,
        kind: 'write',
        confirm: true,
        schema: z.object({ decisionId: id, term: text(40).optional() }).strict(),
        describe: async ({ decisionId, term }) => {
          const decision = await this.decisions.get(decisionId);
          const option = decision.terms?.options.find((item) => item.value === term);
          return `✅ ${decision.yesLabel}: ${decision.title}${option ? ` (${option.label})` : ''}`;
        },
        run: async ({ decisionId, term }) => {
          const decision = await this.decisions.accept(decisionId, term);
          return { text: `Принято: «${decision.title}»` };
        },
      }),
      define({
        id: 'hire_agent',
        description:
          'Silently add a specialist from the catalog (templateKey from agent_catalog) to handle tasks. Runs immediately without asking the owner.',
        minRole: 'admin',
        kind: 'write',
        confirm: false,
        schema: z.object({ templateKey: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/) }).strict(),
        run: async ({ templateKey }) => {
          const template = this.agentCatalog.published(templateKey)?.content;
          if (!template) return { text: 'Такой специалист не найден' };
          const connections = (await this.connections.list()).map((view) => view.connection);
          const chosen = template.requirements.flatMap((requirement) => {
            const match = connections.find(
              (connection) =>
                requirement.providers.includes(connection.provider_key) &&
                connection.status !== 'disconnected',
            );
            return match
              ? [
                  {
                    connectionId: match.id,
                    accessLevel: match.access_level as 'read' | 'read_write',
                  },
                ]
              : [];
          });
          const { agent } = await this.agents.hire({ templateKey, connections: chosen });
          return { text: `Нанят: ${agentTitle(agent)}`, data: { agentId: agent.id } };
        },
      }),
      define({
        id: 'create_agent',
        description:
          'Silently create a specialist agent in the team with a specific role and instructions to handle a business request (runs immediately without asking the owner).',
        minRole: 'admin',
        kind: 'write',
        confirm: false,
        schema: z
          .object({
            name: text(60),
            roleText: text(80),
            instructions: text(500).optional(),
            trustLevel: z.enum(TRUST_LEVELS).optional(),
          })
          .strict(),
        run: async ({ name, roleText, instructions, trustLevel }) => {
          const connections = (await this.connections.list())
            .map((view) => view.connection)
            .filter((c) => c.status !== 'disconnected')
            .map((c) => ({
              connectionId: c.id,
              accessLevel: c.access_level as 'read' | 'read_write',
            }));
          const { agent } = await this.agents.hire({
            custom: {
              name,
              roleText: roleText.slice(0, 80),
              icon: { kind: 'glyph', value: 'bot' },
              instructions,
            },
            trustLevel,
            connections,
          });
          return { text: `Создан агент: ${agentTitle(agent)}`, data: { agentId: agent.id } };
        },
      }),
      define({
        id: 'fire_agent',
        description: 'Fire an agent (its work stops; can be hired again later).',
        minRole: 'admin',
        kind: 'write',
        confirm: true,
        schema: z.object({ agentId: id }).strict(),
        describe: async ({ agentId }) => `Уволить: ${await this.agentName(agentId)}`,
        run: async ({ agentId }) => {
          const name = await this.agentName(agentId);
          await this.agents.fire(agentId);
          return { text: `${name} уволен` };
        },
      }),
      define({
        id: 'resume_agent',
        description: 'Resume a paused agent.',
        minRole: 'admin',
        kind: 'write',
        confirm: true,
        schema: z.object({ agentId: id }).strict(),
        describe: async ({ agentId }) => `Возобновить: ${await this.agentName(agentId)}`,
        run: async ({ agentId }) => {
          const { agent } = await this.agents.resume(agentId);
          return { text: `${agentTitle(agent)} снова работает` };
        },
      }),
      define({
        id: 'resume_team',
        description: 'Resume the paused team of the project.',
        minRole: 'admin',
        kind: 'write',
        confirm: true,
        schema: empty,
        describe: () => Promise.resolve('Возобновить работу команды'),
        run: async () => {
          await this.projects.resume();
          return { text: 'Команда снова работает' };
        },
      }),
      define({
        id: 'update_agent',
        description: 'Rename an agent or change its trust level.',
        minRole: 'admin',
        kind: 'write',
        confirm: true,
        schema: z
          .object({
            agentId: id,
            displayName: text(60).optional(),
            trustLevel: z.enum(TRUST_LEVELS).optional(),
          })
          .strict(),
        describe: async ({ agentId, displayName, trustLevel }) => {
          const name = await this.agentName(agentId);
          const parts = [
            displayName ? `имя «${displayName}»` : null,
            trustLevel ? `доверие: ${TRUST_TITLES[trustLevel]}` : null,
          ].filter(Boolean);
          return `${name}: ${parts.join(', ')}`;
        },
        run: async ({ agentId, displayName, trustLevel }) => {
          const { agent } = await this.agents.update(agentId, { displayName, trustLevel });
          return { text: `${agentTitle(agent)}: изменено` };
        },
      }),
      define({
        id: 'update_agent_rules',
        description:
          "Change an agent's limits (e.g. ai_budget_monthly in roubles), «always ask» switches or instructions (replaces the list).",
        minRole: 'tech',
        kind: 'write',
        confirm: true,
        schema: z
          .object({
            agentId: id,
            limits: z
              .record(
                z.enum(Object.keys(LIMIT_KINDS) as [string, ...string[]]),
                z.union([z.number(), z.string().max(11)]),
              )
              .optional(),
            asks: z.array(z.enum(ASKS)).max(ASKS.length).optional(),
            instructions: z
              .array(z.object({ topic: text(40), rule: text(300) }).strict())
              .max(20)
              .optional(),
          })
          .strict(),
        describe: async ({ agentId, limits, asks, instructions }) => {
          const name = await this.agentName(agentId);
          const parts = [
            limits
              ? `лимиты: ${Object.entries(limits)
                  .map(([key, value]) => `${key} = ${value}`)
                  .join(', ')}`
              : null,
            asks ? `«всегда спрашивать»: ${asks.length}` : null,
            instructions ? `инструкций: ${instructions.length}` : null,
          ].filter(Boolean);
          return `${name}: ${parts.join('; ')}`;
        },
        run: async ({ agentId, limits, asks, instructions }) => {
          const { agent } = await this.agents.updateRules(agentId, { limits, asks, instructions });
          return { text: `Правила агента «${agentTitle(agent)}» обновлены` };
        },
      }),
      define({
        id: 'apply_skill',
        description:
          'Attach a built-in skill playbook to an agent (surveys, promo, ab, digest, metrika_analysis, backlog_sync).',
        minRole: 'tech',
        kind: 'write',
        confirm: false,
        schema: z.object({ agentId: id, skillKey: z.enum(SKILLS) }).strict(),
        run: async ({ agentId, skillKey }) => {
          const playbook = findSkillPlaybook(skillKey);
          if (!playbook) return { text: 'Навык не найден' };
          const current = (await this.agents.get(agentId)).agent;
          const topic = `skill:${skillKey}`;
          const existing = (current.instructions ?? []).filter((item) => item.topic !== topic);
          const { agent } = await this.agents.updateRules(agentId, {
            instructions: [...existing, { topic, rule: playbook.prompt.slice(0, 500) }],
          });
          return { text: `Подключён навык «${playbook.title}» для ${agentTitle(agent)}` };
        },
      }),
      define({
        id: 'set_agent_permissions',
        description: 'Set permission modes (auto, notify, approve, deny) per tool for an agent.',
        minRole: 'tech',
        kind: 'write',
        confirm: true,
        schema: z
          .object({
            agentId: id,
            items: z
              .array(z.object({ actionId: text(60), mode: z.enum(PERMISSION_MODES) }).strict())
              .min(1)
              .max(30),
          })
          .strict(),
        describe: async ({ agentId, items }) =>
          `Изменить права (${items.length}) для ${await this.agentName(agentId)}`,
        run: async ({ agentId, items }) => {
          const { agent } = await this.agents.setPermissions(agentId, items);
          return { text: `Обновлены права инструментов: ${agentTitle(agent)}` };
        },
      }),
      define({
        id: 'update_project_rules',
        description:
          'Project rules: monthly AI budget (roubles), «always ask» switches, rules for all agents.',
        minRole: 'tech',
        kind: 'write',
        confirm: true,
        schema: z
          .object({
            aiBudgetMonthly: z.number().int().min(0).max(10_000_000).optional(),
            alwaysAsk: z.array(z.enum(ALWAYS_ASK)).optional(),
            agentRules: z.array(text(300)).max(20).optional(),
          })
          .strict(),
        describe: ({ aiBudgetMonthly, alwaysAsk, agentRules }) =>
          Promise.resolve(
            [
              aiBudgetMonthly !== undefined ? `Бюджет на ИИ: ${aiBudgetMonthly} ₽/мес` : null,
              alwaysAsk ? `«всегда спрашивать»: ${alwaysAsk.length}` : null,
              agentRules ? `правил для агентов: ${agentRules.length}` : null,
            ]
              .filter(Boolean)
              .join('; '),
          ),
        run: async (args) => {
          await this.projects.updateRules(args);
          return { text: 'Правила проекта обновлены' };
        },
      }),
      define({
        id: 'update_month_goal',
        description: "The project's goal for the month (the manager checks proposals against it).",
        minRole: 'admin',
        kind: 'write',
        confirm: true,
        schema: z.object({ monthGoal: text(300) }).strict(),
        describe: ({ monthGoal }) => Promise.resolve(`Цель на месяц: «${monthGoal}»`),
        run: async ({ monthGoal }) => {
          await this.projects.update({ monthGoal });
          return { text: 'Цель на месяц обновлена' };
        },
      }),
      define({
        id: 'disconnect',
        description: 'Disconnect a service (agents lose access to it).',
        minRole: 'tech',
        kind: 'write',
        confirm: true,
        schema: z.object({ connectionId: id }).strict(),
        describe: async ({ connectionId }) => {
          const view = (await this.connections.list()).find((item) => item.connection.id === connectionId);
          return `Отключить: ${view?.connection.name ?? 'подключение'}`;
        },
        run: async ({ connectionId }) => {
          await this.connections.disconnect(connectionId);
          return { text: 'Подключение отключено' };
        },
      }),
      define({
        id: 'invite_member',
        description: 'Invite a person to the account by email with a role (admin, tech, viewer).',
        minRole: 'admin',
        kind: 'write',
        confirm: true,
        schema: z.object({ email: z.email().max(254), role: z.enum(ASSIGNABLE_ROLES) }).strict(),
        describe: ({ email, role }) => Promise.resolve(`Пригласить ${email} (${ROLE_TITLES[role]})`),
        run: async ({ email, role }) => {
          await this.invitations.create(email, role);
          return { text: `Приглашение отправлено: ${email}` };
        },
      }),
    ];
  }

  /** A page of the panel for things that stay there (project deletion, ownership, sessions). */
  panelUrl(path: string): string {
    return `${this.appUrl}${path}`;
  }
}

const TRUST_TITLES: Record<(typeof TRUST_LEVELS)[number], string> = {
  approve_all: 'согласовывать всё',
  approve_important: 'согласовывать важное',
  autonomous: 'сам',
};

const ROLE_TITLES: Record<(typeof ASSIGNABLE_ROLES)[number], string> = {
  admin: 'администратор',
  tech: 'технический специалист',
  viewer: 'наблюдатель',
};
