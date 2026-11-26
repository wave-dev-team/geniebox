import { Injectable } from '@nestjs/common';

import { AccountDb, type AccountTx } from '../../database/scoped-db.js';
import { JournalService } from '../../journal/journal.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { ProjectContext } from '../projects/project-context.js';
import { StreamPublisher } from '../stream/stream.publisher.js';
import {
  ConversationResponseDto,
  MessageResponseDto,
  type PostMessageDto,
  type PostMessageResponseDto,
} from './dto/conversation.dto.js';
import { type MessagePostedEvent, WORK_EVENTS } from './events/work.events.js';
import { ConversationsRepository } from './repositories/conversations.repository.js';
import { MessageActionsRepository } from './repositories/message-actions.repository.js';
import { WORK_ERRORS, WorkException } from './work.errors.js';
import { findManager, findProjectAgent } from './work-agents.js';

const LIST_LIMIT = 50;
const PAGE = 100;
const TITLE_LENGTH = 80;

/** Conversations with the manager and agents. */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly accountDb: AccountDb,
    private readonly conversations: ConversationsRepository,
    private readonly actions: MessageActionsRepository,
    private readonly journal: JournalService,
    private readonly outbox: OutboxService,
    private readonly stream: StreamPublisher,
    private readonly projectContext: ProjectContext,
  ) {}

  async list(agentId?: string): Promise<ConversationResponseDto[]> {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) =>
      (await this.conversations.list(tx.db, projectId, agentId, LIST_LIMIT)).map((row) =>
        ConversationResponseDto.from(row),
      ),
    );
  }

  async create(agentId?: string): Promise<ConversationResponseDto> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const agent = agentId
        ? await findProjectAgent(tx.db, actor.projectId, agentId)
        : await findManager(tx.db, actor.projectId);
      if (!agent) throw new WorkException(WORK_ERRORS.WORK_AGENT_INVALID);
      const row = await this.conversations.create(tx.db, {
        account_id: tx.accountId,
        project_id: actor.projectId,
        agent_id: agent.id,
        created_by: actor.userId,
      });
      return ConversationResponseDto.from(row);
    });
  }

  async get(id: string): Promise<ConversationResponseDto> {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) =>
      ConversationResponseDto.from(await this.mustFind(tx, projectId, id)),
    );
  }

  async messages(id: string, before?: string): Promise<MessageResponseDto[]> {
    const { projectId } = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      await this.mustFind(tx, projectId, id);
      const rows = await this.conversations.listMessages(
        tx.db,
        id,
        PAGE,
        before ? new Date(before) : undefined,
      );
      const actions = await this.actions.byMessages(
        tx.db,
        rows.map((row) => row.id),
      );
      return rows.map((row) =>
        MessageResponseDto.from(
          row,
          actions.filter((action) => action.message_id === row.id),
        ),
      );
    });
  }

  /**
   * Saves the user's message and a streaming placeholder for the answer, then hands the turn to
   * the worker. The answer arrives over the project stream.
   */
  async post(id: string, dto: PostMessageDto): Promise<PostMessageResponseDto> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const conversation = await this.mustFind(tx, actor.projectId, id);
      if (await this.conversations.hasStreaming(tx.db, id)) {
        throw new WorkException(WORK_ERRORS.CONVERSATION_BUSY);
      }
      const mention = dto.mentionAgentId
        ? await findProjectAgent(tx.db, actor.projectId, dto.mentionAgentId)
        : undefined;
      if (dto.mentionAgentId && !mention) throw new WorkException(WORK_ERRORS.WORK_AGENT_INVALID);
      const message = await this.conversations.insertMessage(tx.db, {
        account_id: tx.accountId,
        conversation_id: id,
        role: 'user',
        author_user_id: actor.userId,
        text: dto.text,
        mode: dto.mode ?? 'approve_all',
        mention_agent_id: mention?.id ?? null,
        channel: 'web',
      });
      const reply = await this.conversations.insertMessage(tx.db, {
        account_id: tx.accountId,
        conversation_id: id,
        role: 'assistant',
        agent_id: mention?.id ?? conversation.agent_id,
        status: 'streaming',
      });
      await this.conversations.touch(
        tx.db,
        id,
        conversation.title ? undefined : dto.text.slice(0, TITLE_LENGTH),
      );
      await this.journal.record(tx, {
        actor: { type: 'user', id: actor.userId, role: actor.role },
        action: 'conversations.message',
        target: { type: 'conversation', id },
        args: { mode: message.mode, mention: mention?.id ?? null, length: dto.text.length },
        status: 'succeeded',
      });
      await this.outbox.add<MessagePostedEvent>(tx, {
        type: WORK_EVENTS.MESSAGE_POSTED,
        payload: {
          projectId: actor.projectId,
          conversationId: id,
          userMessageId: message.id,
          replyMessageId: reply.id,
          byUserId: actor.userId,
        },
      });
      tx.afterCommit(async () => {
        await this.stream.publish(actor.projectId, {
          type: 'message.created',
          conversationId: id,
          messageId: message.id,
        });
        await this.stream.publish(actor.projectId, {
          type: 'message.created',
          conversationId: id,
          messageId: reply.id,
        });
      });
      return { message: MessageResponseDto.from(message), reply: MessageResponseDto.from(reply) };
    });
  }

  private async mustFind(tx: AccountTx, projectId: string, id: string) {
    const conversation = await this.conversations.find(tx.db, projectId, id);
    if (!conversation) throw new WorkException(WORK_ERRORS.CONVERSATION_NOT_FOUND);
    return conversation;
  }
}
