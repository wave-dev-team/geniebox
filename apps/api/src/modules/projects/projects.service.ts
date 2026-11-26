import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema.js';
import { AccountDb, type AccountTx, UserDb } from '../../database/scoped-db.js';
import { JournalService } from '../../journal/journal.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { ScheduledTasksService } from '../../scheduling/scheduled-tasks.service.js';
import { AccountContext, type Actor } from '../accounts/account-context.js';
import { randomSuffix, slugify } from '../accounts/slug.js';
import type { CreateProjectDto, UpdateProjectDto, UpdateProjectRulesDto } from './dto/project.dto.js';
import {
  PROJECT_EVENTS,
  PROJECT_TASKS,
  type ProjectEvent,
  type ProjectOnboardingCompletedEvent,
  type ProjectPausedEvent,
  type ProjectUpdatedEvent,
} from './events/project.events.js';
import { ProjectContext } from './project-context.js';
import { PROJECT_ERRORS, ProjectException } from './projects.errors.js';
import {
  type ProjectRow,
  ProjectsRepository,
  type ProjectUpdate,
  type ProjectWithRole,
} from './repositories/projects.repository.js';

const SLUG_ATTEMPTS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ProjectsService {
  private readonly maxProjects: number;
  private readonly purgeAfterDays: number;

  constructor(
    private readonly accountDb: AccountDb,
    private readonly userDb: UserDb,
    private readonly projects: ProjectsRepository,
    private readonly journal: JournalService,
    private readonly outbox: OutboxService,
    private readonly tasks: ScheduledTasksService,
    private readonly accountContext: AccountContext,
    private readonly projectContext: ProjectContext,
    config: ConfigService<Env, true>,
  ) {
    this.maxProjects = config.get('MAX_PROJECTS_PER_ACCOUNT', { infer: true });
    this.purgeAfterDays = config.get('PROJECT_PURGE_AFTER_DAYS', { infer: true });
  }

  /** Creates a project in the current account; onboarding starts at step 1. */
  create(input: CreateProjectDto): Promise<ProjectRow> {
    const actor = this.accountContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const count = await this.projects.countForAccount(tx.db, tx.accountId);
      if (count >= this.maxProjects) {
        throw new ProjectException(PROJECT_ERRORS.PROJECT_LIMIT_REACHED, {
          messageArgs: { limit: this.maxProjects },
        });
      }
      const project = await this.insertWithFreeSlug(tx, actor, input);
      await this.record(tx, actor, project.id, 'projects.create', {
        name: input.name,
        slug: project.slug,
      });
      await this.outbox.add<ProjectEvent>(tx, {
        type: PROJECT_EVENTS.CREATED,
        payload: { projectId: project.id, byUserId: actor.userId },
      });
      return project;
    });
  }

  listInAccount(): Promise<ProjectRow[]> {
    return this.accountDb.transaction((tx) => this.projects.listForAccount(tx.db, tx.accountId));
  }

  listMine(): Promise<ProjectWithRole[]> {
    return this.userDb.transaction((tx) => this.projects.listForUser(tx.db, tx.userId));
  }

  async get(): Promise<ProjectRow> {
    const { projectId } = this.projectContext.actor();
    const project = await this.accountDb.transaction((tx) => this.projects.findById(tx.db, projectId));
    return project ?? notFound();
  }

  update(dto: UpdateProjectDto): Promise<ProjectRow> {
    return this.change('projects.update', PROJECT_EVENTS.UPDATED, dto, toProjectUpdate(dto));
  }

  updateRules(dto: UpdateProjectRulesDto): Promise<ProjectRow> {
    return this.change('projects.rules.update', PROJECT_EVENTS.RULES_UPDATED, dto, toRulesUpdate(dto));
  }

  /** Last onboarding step. Idempotent: a finished onboarding stays finished. */
  completeOnboarding(): Promise<ProjectRow> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const current = (await this.projects.findById(tx.db, actor.projectId)) ?? notFound();
      if (current.onboarding_step === null) {
        return current;
      }
      const project =
        (await this.projects.update(tx.db, actor.projectId, {
          onboarding_step: null,
          onboarding_completed_at: new Date(),
        })) ?? notFound();
      await this.record(tx, actor, project.id, 'projects.onboarding.complete', {
        plannedAgents: project.planned_agents,
      });
      await this.outbox.add<ProjectOnboardingCompletedEvent>(tx, {
        type: PROJECT_EVENTS.ONBOARDING_COMPLETED,
        payload: {
          projectId: project.id,
          byUserId: actor.userId,
          plannedAgents: project.planned_agents,
        },
      });
      return project;
    });
  }

  /** Project kill switch. With `until`, a scheduled task resumes the team. */
  pause(until?: Date): Promise<ProjectRow> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const project =
        (await this.projects.update(tx.db, actor.projectId, {
          agents_paused: true,
          paused_until: until ?? null,
        })) ?? notFound();
      if (until) {
        await this.tasks.schedule(tx, {
          type: PROJECT_TASKS.RESUME,
          payload: { projectId: project.id, until: until.toISOString() },
          runAt: until,
          dedupeKey: `${project.id}:${until.toISOString()}`,
        });
      }
      await this.record(tx, actor, project.id, 'projects.pause', {
        until: until?.toISOString() ?? null,
      });
      await this.outbox.add<ProjectPausedEvent>(tx, {
        type: PROJECT_EVENTS.PAUSED,
        payload: {
          projectId: project.id,
          byUserId: actor.userId,
          until: until?.toISOString() ?? null,
        },
      });
      return project;
    });
  }

  resume(): Promise<ProjectRow> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const project =
        (await this.projects.update(tx.db, actor.projectId, {
          agents_paused: false,
          paused_until: null,
        })) ?? notFound();
      await this.record(tx, actor, project.id, 'projects.resume', {});
      await this.outbox.add<ProjectEvent>(tx, {
        type: PROJECT_EVENTS.RESUMED,
        payload: { projectId: project.id, byUserId: actor.userId },
      });
      return project;
    });
  }

  /**
   * Soft delete: the project disappears at once, agents stop, data is purged after the
   * grace period. The typed name guards against deleting the wrong project.
   */
  delete(confirmName: string): Promise<void> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const project = (await this.projects.findById(tx.db, actor.projectId)) ?? notFound();
      if (confirmName.trim() !== project.name.trim()) {
        throw new ProjectException(PROJECT_ERRORS.PROJECT_NAME_MISMATCH);
      }
      await this.projects.softDelete(tx.db, project.id);
      const purgeAt = new Date(Date.now() + this.purgeAfterDays * DAY_MS);
      await this.tasks.schedule(tx, {
        type: PROJECT_TASKS.PURGE,
        payload: { projectId: project.id },
        runAt: purgeAt,
        dedupeKey: project.id,
      });
      await this.record(tx, actor, project.id, 'projects.delete', {
        name: project.name,
        purgeAt: purgeAt.toISOString(),
      });
      await this.outbox.add<ProjectEvent>(tx, {
        type: PROJECT_EVENTS.DELETED,
        payload: { projectId: project.id, byUserId: actor.userId },
      });
    });
  }

  private change(action: string, event: string, args: object, values: ProjectUpdate): Promise<ProjectRow> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      if (values.onboarding_step !== undefined) {
        const current = (await this.projects.findById(tx.db, actor.projectId)) ?? notFound();
        // A finished onboarding is never reopened by a late step update from another tab.
        if (current.onboarding_step === null) {
          delete values.onboarding_step;
        }
      }
      if (Object.keys(values).length === 0) {
        return (await this.projects.findById(tx.db, actor.projectId)) ?? notFound();
      }
      const project = (await this.projects.update(tx.db, actor.projectId, values)) ?? notFound();
      await this.record(tx, actor, project.id, action, args);
      await this.outbox.add<ProjectUpdatedEvent>(tx, {
        type: event,
        payload: { projectId: project.id, byUserId: actor.userId, fields: Object.keys(values) },
      });
      return project;
    });
  }

  private async insertWithFreeSlug(
    tx: AccountTx,
    actor: Actor,
    input: CreateProjectDto,
  ): Promise<ProjectRow> {
    const base = {
      account_id: tx.accountId,
      name: input.name,
      sphere: input.sphere ?? null,
      about: input.about ?? null,
      goals: input.goals ?? [],
      created_by: actor.userId,
    };
    if (input.slug) {
      return (
        (await this.projects.insertIfSlugFree(tx.db, { ...base, slug: input.slug })) ?? slugTaken(input.slug)
      );
    }
    const stem = slugify(input.name, 'project');
    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
      const slug = attempt === 0 ? stem : `${stem.slice(0, 55)}-${randomSuffix()}`;
      const project = await this.projects.insertIfSlugFree(tx.db, { ...base, slug });
      if (project) return project;
    }
    const fallback = `project-${randomSuffix()}${randomSuffix()}`;
    return (await this.projects.insertIfSlugFree(tx.db, { ...base, slug: fallback })) ?? slugTaken(fallback);
  }

  private record(
    tx: AccountTx,
    actor: Actor,
    projectId: string,
    action: string,
    args: unknown,
  ): Promise<void> {
    return this.journal.record(tx, {
      actor: { type: 'user', id: actor.userId, role: actor.role },
      action,
      target: { type: 'project', id: projectId },
      args,
      status: 'succeeded',
    });
  }
}

function notFound(): never {
  throw new ProjectException(PROJECT_ERRORS.PROJECT_NOT_FOUND);
}

function slugTaken(slug: string): never {
  throw new ProjectException(PROJECT_ERRORS.PROJECT_SLUG_TAKEN, { messageArgs: { slug } });
}

/** Drops undefined keys so that PATCH changes only what was sent. */
function defined(values: Record<string, unknown>): ProjectUpdate {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

/** Null clears nullable columns; for NOT NULL columns null means "leave as is". */
function toProjectUpdate(dto: UpdateProjectDto): ProjectUpdate {
  return defined({
    name: dto.name ?? undefined,
    sphere: dto.sphere,
    about: dto.about,
    goals: dto.goals ?? undefined,
    month_goal: dto.monthGoal,
    main_metric: dto.mainMetric ?? undefined,
    custom_metric: dto.customMetric,
    currency: dto.currency ?? undefined,
    timezone: dto.timezone ?? undefined,
    number_format: dto.numberFormat ?? undefined,
    date_format: dto.dateFormat ?? undefined,
    week_start: dto.weekStart ?? undefined,
    client_language: dto.clientLanguage ?? undefined,
    client_tone: dto.clientTone ?? undefined,
    client_address: dto.clientAddress ?? undefined,
    client_signature: dto.clientSignature,
    journal_retention_days: dto.journalRetentionDays ?? undefined,
    client_data_retention_days: dto.clientDataRetentionDays ?? undefined,
    planned_agents: dto.plannedAgents ?? undefined,
    onboarding_step: dto.onboardingStep ?? undefined,
  });
}

function toRulesUpdate(dto: UpdateProjectRulesDto): ProjectUpdate {
  return defined({
    default_trust_level: dto.defaultTrustLevel ?? undefined,
    probation_days: dto.probationDays ?? undefined,
    trust_streak: dto.trustStreak ?? undefined,
    always_ask: dto.alwaysAsk ?? undefined,
    agent_rules: dto.agentRules ?? undefined,
    ai_budget_monthly: dto.aiBudgetMonthly ?? undefined,
  });
}
