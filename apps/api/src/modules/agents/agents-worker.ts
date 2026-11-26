import { z } from 'zod';

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { AccountDb } from '../../database/scoped-db.js';
import { JournalService } from '../../journal/journal.service.js';
import { OnOutboxEvent } from '../../outbox/on-outbox-event.decorator.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import type { OutboxEnvelope } from '../../outbox/outbox.types.js';
import { ScheduledTaskRegistry } from '../../scheduling/scheduled-task.registry.js';
import { CatalogService } from '../catalog/catalog.service.js';
import {
  PROJECT_EVENTS,
  type ProjectEvent,
  type ProjectOnboardingCompletedEvent,
} from '../projects/events/project.events.js';
import { AgentHiring } from './agent-hiring.js';
import { AgentException } from './agents.errors.js';
import { AGENT_EVENTS, AGENT_TASKS, type AgentEvent } from './events/agent.events.js';
import { AgentsRepository } from './repositories/agents.repository.js';

/**
 * Worker side of agents: the manager of every new project, the team picked in onboarding,
 * end of probation and timed pauses. All handlers are idempotent (at-least-once delivery).
 */
@Injectable()
export class AgentsWorker implements OnModuleInit {
  private readonly logger = new Logger(AgentsWorker.name);

  constructor(
    private readonly accountDb: AccountDb,
    private readonly agents: AgentsRepository,
    private readonly hiring: AgentHiring,
    private readonly journal: JournalService,
    private readonly outbox: OutboxService,
    private readonly registry: ScheduledTaskRegistry,
    private readonly catalog: CatalogService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      type: AGENT_TASKS.RESUME,
      payloadSchema: z.object({ agentId: z.uuid(), until: z.iso.datetime({ offset: true }) }),
      handle: (payload) => this.resume(payload.agentId, new Date(payload.until)),
    });
    this.registry.register({
      type: AGENT_TASKS.PROBATION_END,
      payloadSchema: z.object({ agentId: z.uuid() }),
      handle: (payload) => this.endProbation(payload.agentId),
    });
  }

  @OnOutboxEvent(PROJECT_EVENTS.CREATED)
  async onProjectCreated(envelope: OutboxEnvelope<ProjectEvent>): Promise<void> {
    await this.accountDb.transaction(async (tx) => {
      await this.agents.ensureManager(tx.db, {
        account_id: tx.accountId,
        project_id: envelope.payload.projectId,
        kind: 'manager',
        display_name: 'Управляющий',
        icon_kind: 'glyph',
        icon_value: 'manager',
        status: 'active',
        trust_level: 'approve_important',
        hired_by: envelope.payload.byUserId,
      });
    });
  }

  /** Hires the agents picked in onboarding, attaching matching connections. */
  @OnOutboxEvent(PROJECT_EVENTS.ONBOARDING_COMPLETED)
  async onOnboardingCompleted(envelope: OutboxEnvelope<ProjectOnboardingCompletedEvent>): Promise<void> {
    const { projectId, byUserId, plannedAgents } = envelope.payload;
    for (const key of plannedAgents) {
      const template = this.catalog.published(key);
      if (!template) continue;
      try {
        await this.accountDb.transaction(async (tx) => {
          if (await this.agents.templateHired(tx.db, projectId, key)) return;
          await this.hiring.hire(tx, {
            projectId,
            templateKey: key,
            connections: await this.hiring.matchingConnections(tx, projectId, template),
            strictRequirements: false,
            actor: { userId: byUserId },
          });
        });
      } catch (error) {
        // A full team or a deleted project is a business outcome, not a reason to retry.
        if (error instanceof AgentException) {
          this.logger.warn({ projectId, template: key, code: error.code }, 'Planned agent not hired');
          continue;
        }
        throw error;
      }
    }
  }

  async resume(agentId: string, until: Date): Promise<void> {
    await this.accountDb.transaction(async (tx) => {
      const agent = await this.agents.findById(tx.db, agentId);
      if (agent?.status !== 'paused' || agent.paused_until?.getTime() !== until.getTime()) return;
      const onProbation = agent.probation_until !== null && agent.probation_until.getTime() > Date.now();
      await this.agents.update(tx.db, agentId, {
        status: onProbation ? 'probation' : 'active',
        paused_until: null,
      });
      await this.systemEvent(tx, agent.project_id, agentId, 'agents.resume', AGENT_EVENTS.RESUMED);
    });
  }

  async endProbation(agentId: string): Promise<void> {
    await this.accountDb.transaction(async (tx) => {
      const agent = await this.agents.findById(tx.db, agentId);
      if (agent?.status !== 'probation') return;
      await this.agents.update(tx.db, agentId, { status: 'active' });
      await this.systemEvent(tx, agent.project_id, agentId, 'agents.probation.end', AGENT_EVENTS.UPDATED);
    });
  }

  private async systemEvent(
    tx: Parameters<Parameters<AccountDb['transaction']>[0]>[0],
    projectId: string,
    agentId: string,
    action: string,
    type: string,
  ): Promise<void> {
    await this.journal.record(tx, {
      actor: { type: 'system', id: 'scheduler' },
      action,
      target: { type: 'agent', id: agentId },
      status: 'succeeded',
    });
    await this.outbox.add<AgentEvent>(tx, { type, payload: { projectId, agentId, byUserId: null } });
  }
}
