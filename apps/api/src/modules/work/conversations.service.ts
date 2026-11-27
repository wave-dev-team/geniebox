import { Injectable } from '@nestjs/common';

import { hasRoleAtLeast } from '../../common/auth/account-role.js';
import { AccountDb, type AccountTx } from '../../database/scoped-db.js';
import { JournalService } from '../../journal/journal.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { readManagerContext } from '../accounts/manager-context.js';
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
    const { projectId, userId } = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) =>
      (await this.conversations.list(tx.db, projectId, agentId, LIST_LIMIT, userId)).map((row) =>
        ConversationResponseDto.from(row),
      ),
    );
  }

  async manager(): Promise<ConversationResponseDto | null> {
    const { projectId, userId } = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const row = await this.conversations.managerForUser(tx.db, projectId, userId);
      return row ? ConversationResponseDto.from(row) : null;
    });
  }

  async create(agentId?: string): Promise<ConversationResponseDto> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const agent = agentId
        ? await findProjectAgent(tx.db, actor.projectId, agentId)
        : await findManager(tx.db, actor.projectId);
      if (!agent) throw new WorkException(WORK_ERRORS.WORK_AGENT_INVALID);
      if (agent.kind === 'manager') {
        return ConversationResponseDto.from(
          await this.conversations.ensureManager(
            tx.db,
            tx.accountId,
            actor.projectId,
            actor.userId,
            agent.id,
          ),
        );
      }
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
    const { projectId, userId } = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) =>
      ConversationResponseDto.from(await this.mustFind(tx, projectId, userId, id)),
    );
  }

  async messages(id: string, before?: string, beforeId?: string): Promise<MessageResponseDto[]> {
    const { projectId, userId, role } = this.projectContext.actor();
    const notices = ['team_paused', 'team_resumed'];
    if (hasRoleAtLeast(role, 'tech'))
      notices.push('rules_changed', 'connections_disconnected', 'decision_accepted');
    if (hasRoleAtLeast(role, 'admin')) notices.push('budget_changed');
    return this.accountDb.transaction(async (tx) => {
      const conversation = await this.mustFind(tx, projectId, userId, id);
      const boundary = conversation.manager_thread
        ? await readManagerContext(tx.db, tx.accountId, userId)
        : undefined;
      const rows = await this.conversations.listMessages(tx.db, conversation.id, PAGE, {
        before: before ? new Date(before) : undefined,
        noticeKinds: notices,
        after: boundary?.historySince,
        beforeId,
      });
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
  async post(requestedId: string, dto: PostMessageDto): Promise<PostMessageResponseDto> {
    const actor = this.projectContext.actor();
    return this.accountDb.transaction(async (tx) => {
      const conversation = await this.mustFind(tx, actor.projectId, actor.userId, requestedId);
      const id = conversation.id;
      await this.conversations.lock(tx.db, id);
      const boundary = conversation.manager_thread
        ? await readManagerContext(tx.db, tx.accountId, actor.userId)
        : undefined;
      if (await this.conversations.hasStreaming(tx.db, id, boundary?.historySince)) {
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
      const manager = conversation.manager_thread ? await findManager(tx.db, actor.projectId) : undefined;
      if (conversation.manager_thread && !manager) throw new WorkException(WORK_ERRORS.WORK_AGENT_INVALID);
      const reply = await this.conversations.insertMessage(tx.db, {
        account_id: tx.accountId,
        conversation_id: id,
        role: 'assistant',
        agent_id: mention?.id ?? manager?.id ?? conversation.agent_id,
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
          recipientUserId: actor.userId,
          conversationId: id,
          messageId: message.id,
        });
        await this.stream.publish(actor.projectId, {
          type: 'message.created',
          recipientUserId: actor.userId,
          conversationId: id,
          messageId: reply.id,
        });
      });
      return { message: MessageResponseDto.from(message), reply: MessageResponseDto.from(reply) };
    });
  }

  private async mustFind(tx: AccountTx, projectId: string, userId: string, id: string) {
    const requested = await this.conversations.find(tx.db, projectId, id);
    if (requested?.created_by === userId) {
      const conversation = requested.merged_into
        ? await this.conversations.find(tx.db, projectId, requested.merged_into)
        : requested;
      if (conversation?.created_by === userId && !conversation.private_archive) return conversation;
    }
    throw new WorkException(WORK_ERRORS.CONVERSATION_NOT_FOUND);
  }
}
