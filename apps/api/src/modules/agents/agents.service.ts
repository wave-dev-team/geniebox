import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ClsService } from 'nestjs-cls';

import type { CreateAgent, UpdateAgent } from '@workspace/types';

import { type AgentOwner, AgentsRepository } from './agents.repository.js';

class AgentSettingsEvent {
  readonly eventId = randomUUID();
  readonly occurredAt = new Date().toISOString();

  constructor(
    readonly tenantId: string,
    readonly agentId: string,
    readonly traceId: string,
  ) {}
}

@Injectable()
export class AgentsService {
  constructor(
    private readonly repository: AgentsRepository,
    private readonly events: EventEmitter2,
    private readonly context: ClsService,
  ) {}

  list(owner: AgentOwner) {
    return this.repository.list(owner);
  }

  find(owner: AgentOwner, id: string) {
    return this.repository.find(owner, id);
  }

  async create(owner: AgentOwner, input: CreateAgent) {
    const agent = await this.repository.create(owner, input);
    if (agent) this.publish('agent.created', owner.tenantId, agent.id);
    return agent;
  }

  async update(owner: AgentOwner, id: string, input: UpdateAgent) {
    const agent = await this.repository.update(owner, id, input);
    if (agent) this.publish('agent.settings_updated', owner.tenantId, agent.id);
    return agent;
  }

  private publish(topic: string, tenantId: string, id: string) {
    this.events.emit(topic, new AgentSettingsEvent(tenantId, id, this.context.getId() ?? randomUUID()));
  }
}
