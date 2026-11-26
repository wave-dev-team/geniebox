import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { hasRoleAtLeast } from '../../common/auth/account-role.js';
import {
  ConflictException,
  DomainException,
  EntityNotFoundException,
  ForbiddenActionException,
} from '../../common/exceptions/index.js';
import type { Env } from '../../config/env.schema.js';
import { AccountDb } from '../../database/scoped-db.js';
import { SystemDb } from '../../database/system-db.js';
import { StreamPublisher } from '../stream/stream.publisher.js';
import { ConversationsService } from '../work/conversations.service.js';
import { DecisionsService } from '../work/decisions.service.js';
import { ConversationsRepository } from '../work/repositories/conversations.repository.js';
import {
  type MessageActionKind,
  type MessageActionPayload,
  type MessageActionRow,
  MessageActionsRepository,
} from '../work/repositories/message-actions.repository.js';
import { ErrorText } from './error-text.js';
import { PanelActions } from './panel-actions.js';
import { UserActor } from './user-actor.js';

const BUTTON_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PressResult {
  status: 'done' | 'failed';
  text: string;
  url?: string;
  /** The conversation the press wrote into (reply buttons): its answer comes as usual. */
  conversationId?: string;
  projectId: string;
  messageId: string;
}

/**
 * Buttons of messages: created by the manager's tools, pressed in the panel. The
 * press runs the stored action with the presser's rights at that moment; whatever the model
 * writes later runs nothing.
 */
@Injectable()
export class MessageActionsService {
  private readonly logger = new Logger(MessageActionsService.name);
  private readonly appUrl: string;

  constructor(
    private readonly accountDb: AccountDb,
    // SystemDb: a press carries only the button id; whose account it is comes first.
    private readonly systemDb: SystemDb,
    private readonly repo: MessageActionsRepository,
    private readonly conversations: ConversationsRepository,
    private readonly conversationsService: ConversationsService,
    private readonly decisions: DecisionsService,
    private readonly panel: PanelActions,
    private readonly actor: UserActor,
    private readonly stream: StreamPublisher,
    private readonly errors: ErrorText,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_PUBLIC_URL', { infer: true });
  }

  /** Adds a button under a message (inside the caller's account context). */
  async add(input: {
    messageId: string;
    kind: MessageActionKind;
    label: string;
    payload: MessageActionPayload;
    /** A link the platform made (checkout, connection form) rather than the model. */
    trusted?: boolean;
  }): Promise<MessageActionRow | undefined> {
    if (
      input.kind === 'link' &&
      'url' in input.payload &&
      !input.trusted &&
      !this.isPanelUrl(input.payload.url)
    ) {
      return undefined;
    }
    return this.accountDb.transaction((tx) =>
      this.repo.add(tx.db, {
        accountId: tx.accountId,
        messageId: input.messageId,
        kind: input.kind,
        label: input.label,
        payload: input.payload,
        expiresAt: new Date(Date.now() + BUTTON_TTL_MS),
      }),
    );
  }

  /** Only pages of the panel, never an outside site the model made up. */
  isPanelUrl(url: string): boolean {
    try {
      const target = new URL(url);
      const app = new URL(this.appUrl);
      return target.origin === app.origin;
    } catch {
      return false;
    }
  }

  /** Whose button is it: account and message (ids only). */
  async locate(actionId: string): Promise<{ accountId: string; messageId: string } | undefined> {
    const row = await this.systemDb.transaction((trx) =>
      trx
        .selectFrom('message_actions')
        .select(['account_id', 'message_id'])
        .where('id', '=', actionId)
        .executeTakeFirst(),
    );
    return row ? { accountId: row.account_id, messageId: row.message_id } : undefined;
  }

  async press(actionId: string, userId: string, expectProjectId?: string): Promise<PressResult> {
    const located = await this.locate(actionId);
    if (!located) throw new EntityNotFoundException();
    const role = await this.actor.accountRole(userId, located.accountId);
    if (!role) throw new EntityNotFoundException();

    return this.actor.run({ userId, accountId: located.accountId, role }, async () => {
      // Claim the button: pending → done in one transaction, so two presses run it once.
      const claimed = await this.accountDb.transaction(async (tx) => {
        const action = await this.repo.find(tx.db, actionId, true);
        if (!action) throw new EntityNotFoundException();
        const message = await this.conversations.findMessage(tx.db, action.message_id);
        const conversation = message
          ? await this.conversations.findById(tx.db, message.conversation_id)
          : undefined;
        if (!message || !conversation) {
          throw new EntityNotFoundException();
        }
        if (expectProjectId && conversation.project_id !== expectProjectId) {
          throw new EntityNotFoundException();
        }
        if (action.status === 'done') throw new ConflictException();
        if (action.status === 'expired' || action.expires_at.getTime() < Date.now()) {
          await this.repo.settle(tx.db, action.id, { status: 'expired', result: null, usedBy: null });
          return { expired: true as const };
        }
        if (action.kind === 'link') {
          return { action, conversation, link: true as const };
        }
        this.authorize(action, role);
        await this.repo.settle(tx.db, action.id, { status: 'done', result: null, usedBy: userId });
        return { action, conversation };
      });
      if ('expired' in claimed) throw new ConflictException();
      const { action, conversation } = claimed;
      const base = { projectId: conversation.project_id, messageId: action.message_id };
      if ('link' in claimed) {
        return {
          ...base,
          status: 'done',
          text: action.label,
          url: 'url' in action.payload ? action.payload.url : undefined,
        };
      }

      try {
        const result = await this.actor.run(
          { userId, accountId: located.accountId, role, projectId: conversation.project_id },
          () => this.execute(action, conversation.id),
        );
        await this.settle(action, 'done', result.text, userId, conversation.project_id, conversation.id);
        return { ...base, status: 'done', ...result };
      } catch (error) {
        const text = this.errors.of(error, await this.actor.locale(userId));
        if (!(error instanceof DomainException)) {
          this.logger.error({ err: error, actionId }, 'Button action failed');
        }
        // Back to pending: after fixing the cause (money, a connection) the same button works.
        await this.settle(action, 'pending', text, null, conversation.project_id, conversation.id);
        return { ...base, status: 'failed', text };
      }
    });
  }

  private authorize(action: MessageActionRow, role: Parameters<typeof hasRoleAtLeast>[0]): void {
    if (action.kind === 'reply') {
      // Writing in a dialog: tech and up, as in the panel.
      if (!hasRoleAtLeast(role, 'tech')) {
        throw new ForbiddenActionException();
      }
      return;
    }
    if (action.kind === 'decision') {
      if (role !== 'owner' && role !== 'admin') {
        throw new ForbiddenActionException();
      }
      return;
    }
    if (action.kind === 'action' && 'actionId' in action.payload) {
      const panel = this.panel.get(action.payload.actionId);
      if (!panel || !this.panel.allowed(panel, role)) {
        throw new ForbiddenActionException();
      }
    }
  }

  private async execute(
    action: MessageActionRow,
    conversationId: string,
  ): Promise<{ text: string; url?: string; conversationId?: string }> {
    const payload = action.payload;
    if (action.kind === 'reply' && 'text' in payload) {
      await this.conversationsService.post(conversationId, {
        text: payload.text,
        mode: 'approve_important',
      });
      return { text: payload.text, conversationId };
    }
    if (action.kind === 'decision' && 'decisionId' in payload) {
      const decision =
        payload.verdict === 'accept'
          ? await this.decisions.accept(payload.decisionId, payload.term)
          : await this.decisions.reject(payload.decisionId, undefined);
      return {
        text:
          payload.verdict === 'accept' ? `Принято: «${decision.title}»` : `Отклонено: «${decision.title}»`,
      };
    }
    if (action.kind === 'action' && 'actionId' in payload) {
      const panel = this.panel.get(payload.actionId);
      if (!panel) throw new EntityNotFoundException();
      const parsed = panel.schema.parse(payload.args);
      const result = await panel.run(parsed);
      return { text: result.text, url: result.url };
    }
    throw new EntityNotFoundException();
  }

  private async settle(
    action: MessageActionRow,
    status: 'done' | 'pending',
    result: string,
    usedBy: string | null,
    projectId: string,
    conversationId: string,
  ): Promise<void> {
    await this.accountDb.transaction((tx) => this.repo.settle(tx.db, action.id, { status, result, usedBy }));
    await this.stream.publish(projectId, {
      type: 'message.updated',
      conversationId,
      messageId: action.message_id,
    });
  }
}
