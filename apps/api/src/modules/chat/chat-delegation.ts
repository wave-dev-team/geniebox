import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import type { Agent, AgentTask } from '@workspace/types';

import { AgentsService } from '../agents/agents.service.js';
import { type ChatJob, ChatRepository } from './chat.repository.js';
import { canRetryModel, ChatCompletion, DailyLimitError } from './chat-completion.js';
import { buildMessages, createRedactor } from './chat-context.js';
import { ModelError } from './chat-model.js';
import { plannerPrompt, specialistPrompt } from './manager-prompt.js';

const selectionSchema = z.strictObject({
  indexes: z.array(z.number().int().nonnegative()).max(2),
});

type TurnContext = NonNullable<Awaited<ReturnType<ChatRepository['context']>>>;

class AgentTaskEvent {
  readonly eventId = randomUUID();
  readonly occurredAt = new Date().toISOString();

  constructor(
    readonly tenantId: string,
    readonly turnId: string,
    readonly agentId: string,
    readonly traceId: string,
  ) {}
}

@Injectable()
export class ChatDelegation {
  constructor(
    private readonly agents: AgentsService,
    private readonly repository: ChatRepository,
    private readonly completion: ChatCompletion,
    private readonly events: EventEmitter2,
  ) {}

  async run(job: ChatJob, context: TurnContext, finalAttempt: boolean) {
    const redact = createRedactor(context.name);
    if (!context.current.planned) {
      const available = (await this.agents.list(job)).filter((agent) => agent.enabled);
      const selected = await this.select(
        job,
        redact(context.current.message),
        available,
        redact,
        finalAttempt,
      );
      const assigned = await this.repository.plan(job, selected);
      for (const task of assigned) this.publish(job, task.agent_id, 'assigned');
    }

    const notes: string[] = [];
    for (const task of await this.repository.tasks(job)) {
      const result =
        task.status === 'completed'
          ? task.result
          : task.status === 'failed'
            ? null
            : await this.execute(job, task, context, finalAttempt);
      if (result) notes.push(redact(result).slice(0, 1100));
    }
    return notes;
  }

  private async select(
    job: ChatJob,
    question: string,
    available: Agent[],
    redact: (text: string) => string,
    finalAttempt: boolean,
  ): Promise<Agent[]> {
    if (!available.length) return [];
    const descriptions = available.map((agent, index) => ({
      index,
      name: redact(agent.name),
      description: redact(agent.instructions).slice(0, 180),
    }));
    let selected: z.infer<typeof selectionSchema> | undefined;
    try {
      await this.completion.complete(job, {
        role: 'manager.plan',
        version: '1',
        messages: [
          { role: 'system', content: plannerPrompt },
          { role: 'user', content: JSON.stringify({ question, specialists: descriptions }) },
        ],
        responseSchema: {
          type: 'object',
          properties: {
            indexes: {
              type: 'array',
              maxItems: 2,
              items: { type: 'integer', enum: descriptions.map(({ index }) => index) },
            },
          },
          required: ['indexes'],
          additionalProperties: false,
        },
        validate: (answer) => {
          const parsed = selectionSchema.safeParse(parseJson(answer));
          if (!parsed.success || parsed.data.indexes.some((index) => !available[index])) return false;
          selected = parsed.data;
          return true;
        },
      });
    } catch (error) {
      if (canRetryModel(error) && !finalAttempt) throw error;
      if (!(error instanceof ModelError || error instanceof DailyLimitError)) throw error;
    }
    return [...new Set(selected?.indexes)].flatMap((index) => (available[index] ? [available[index]] : []));
  }

  private async execute(job: ChatJob, task: AgentTask, context: TurnContext, finalAttempt: boolean) {
    const agent = await this.agents.find(job, task.agentId);
    if (!agent?.enabled) {
      await this.setStatus(job, task.agentId, 'failed');
      return null;
    }
    await this.setStatus(job, task.agentId, 'running');
    const redact = createRedactor(context.name);
    const messages = buildMessages(
      context.current.message,
      context.previous,
      context.name,
      `${specialistPrompt}\nAssigned instructions:\n${redact(agent.instructions)}`,
    );
    let answer: string;
    try {
      answer = await this.completion.complete(job, { role: 'agent.chat', version: '1', messages });
    } catch (error) {
      if (canRetryModel(error) && !finalAttempt) throw error;
      if (!(error instanceof ModelError || error instanceof DailyLimitError)) throw error;
      await this.setStatus(job, task.agentId, 'failed');
      return null;
    }

    await this.setStatus(job, task.agentId, 'completed', answer);
    return answer;
  }

  private async setStatus(
    job: ChatJob,
    id: string,
    status: 'running' | 'completed' | 'failed',
    answer?: string,
  ) {
    if (await this.repository.updateTask(job, id, status, answer)) {
      this.publish(job, id, status === 'running' ? 'started' : status);
    }
  }

  private publish(job: ChatJob, agentId: string, action: string) {
    this.events.emit(
      `agent.task_${action}`,
      new AgentTaskEvent(job.tenantId, job.turnId, agentId, job.traceId),
    );
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
