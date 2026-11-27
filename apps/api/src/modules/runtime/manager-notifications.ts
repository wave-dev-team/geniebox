import { Injectable } from '@nestjs/common';

import { AccountDb } from '../../database/scoped-db.js';
import { OnOutboxEvent } from '../../outbox/on-outbox-event.decorator.js';
import type { OutboxEnvelope } from '../../outbox/outbox.types.js';
import { CONNECTION_EVENTS } from '../connections/events/connection.events.js';
import {
  PROJECT_EVENTS,
  type ProjectEvent,
  type ProjectUpdatedEvent,
} from '../projects/events/project.events.js';
import { StreamPublisher } from '../stream/stream.publisher.js';
import { type DecisionDecidedEvent, WORK_EVENTS } from '../work/events/work.events.js';
import { ConversationsRepository } from '../work/repositories/conversations.repository.js';
import { DecisionsRepository } from '../work/repositories/decisions.repository.js';
import type { Card } from '../work/work.constants.js';
import { findManager } from '../work/work-agents.js';

type Notice = {
  kind:
    | 'decision_accepted'
    | 'team_paused'
    | 'team_resumed'
    | 'rules_changed'
    | 'budget_changed'
    | 'connections_disconnected';
  audience: 'all' | 'operators' | 'admins';
  cards?: Card[];
};

@Injectable()
export class ManagerNotifications {
  constructor(
    private readonly accountDb: AccountDb,
    private readonly conversations: ConversationsRepository,
    private readonly decisions: DecisionsRepository,
    private readonly stream: StreamPublisher,
  ) {}

  @OnOutboxEvent(PROJECT_EVENTS.PAUSED)
  paused(event: OutboxEnvelope<ProjectEvent>) {
    return this.deliver(event, { kind: 'team_paused', audience: 'all' });
  }

  @OnOutboxEvent(PROJECT_EVENTS.RESUMED)
  resumed(event: OutboxEnvelope<ProjectEvent>) {
    return this.deliver(event, { kind: 'team_resumed', audience: 'all' });
  }

  @OnOutboxEvent(PROJECT_EVENTS.RULES_UPDATED)
  async rules(event: OutboxEnvelope<ProjectUpdatedEvent>): Promise<void> {
    const { fields } = event.payload;
    if (fields.some((field) => field !== 'ai_budget_monthly')) {
      await this.deliver(event, { kind: 'rules_changed', audience: 'operators' });
    }
    if (fields.includes('ai_budget_monthly')) {
      await this.deliver(event, { kind: 'budget_changed', audience: 'admins' });
    }
  }

  @OnOutboxEvent(CONNECTION_EVENTS.PROJECT_DISCONNECTED)
  disconnected(event: OutboxEnvelope<ProjectEvent>) {
    return this.deliver(event, { kind: 'connections_disconnected', audience: 'operators' });
  }

  @OnOutboxEvent(WORK_EVENTS.DECISION_DECIDED)
  async decision(event: OutboxEnvelope<DecisionDecidedEvent>): Promise<void> {
    const { projectId, decisionId } = event.payload;
    const decision = await this.accountDb.transaction((tx) =>
      this.decisions.find(tx.db, projectId, decisionId),
    );
    if (decision?.status !== 'accepted' && decision?.status !== 'modified') return;
    await this.deliver(event, {
      kind: 'decision_accepted',
      audience: 'operators',
      cards: [{ type: 'decision', id: decision.id }],
    });
  }

  private async deliver(event: OutboxEnvelope<ProjectEvent>, notice: Notice): Promise<void> {
    const { projectId } = event.payload;
    await this.accountDb.transaction(async (tx) => {
      const project = await tx.db
        .selectFrom('projects')
        .select('id')
        .where('id', '=', projectId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!project) return;
      const manager = await findManager(tx.db, projectId);
      if (!manager) throw new Error('Cannot deliver project notices before the manager is provisioned');

      let members = tx.db
        .selectFrom('account_members')
        .select('user_id')
        .where('account_id', '=', tx.accountId)
        .where('created_at', '<=', new Date(event.occurredAt));
      if (notice.audience !== 'all') {
        members = members.where(
          'role',
          'in',
          notice.audience === 'admins' ? ['owner', 'admin'] : ['owner', 'admin', 'tech'],
        );
      }
      for (const { user_id: userId } of await members.orderBy('user_id').execute()) {
        const existing = await this.conversations.managerForUser(tx.db, projectId, userId);
        const conversation =
          existing ??
          (await this.conversations.ensureManager(tx.db, tx.accountId, projectId, userId, manager.id));
        const message = await this.conversations.insertNotification(tx.db, {
          account_id: tx.accountId,
          conversation_id: conversation.id,
          role: 'system',
          notification_event_id: event.eventId,
          notification_kind: notice.kind,
          cards: JSON.stringify(notice.cards ?? []),
          created_at: new Date(event.occurredAt),
        });
        if (!message) continue;
        tx.afterCommit(() =>
          this.stream.publish(projectId, {
            type: 'message.created',
            recipientUserId: userId,
            conversationId: conversation.id,
            messageId: message.id,
          }),
        );
      }
    });
  }
}
