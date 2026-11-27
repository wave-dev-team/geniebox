import { z } from 'zod';

import { Injectable, type OnModuleInit } from '@nestjs/common';

import { AccountDb } from '../../../database/scoped-db.js';
import { MessageActionsService } from '../../actions/message-actions.service.js';
import { PanelActions } from '../../actions/panel-actions.js';
import { UserActor } from '../../actions/user-actor.js';
import { ConversationsRepository } from '../../work/repositories/conversations.repository.js';
import { defineTool, type ToolContext } from '../broker/broker.types.js';
import { ToolError } from '../broker/tool-executor.js';
import { ToolRegistry } from '../broker/tool-registry.js';

const button = z
  .object({
    label: z.string().trim().min(1).max(40),
    reply: z.string().trim().min(1).max(200).optional(),
    url: z.url().max(500).optional(),
  })
  .strict()
  .refine((item) => Boolean(item.reply) !== Boolean(item.url), {
    message: 'exactly one of reply or url',
  });

const offerButtonsSchema = z.object({ buttons: z.array(button).min(1).max(6) }).strict();

const sendChartSchema = z
  .object({
    metricKey: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
    days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
  })
  .strict();

/**
 * The manager acting for the person it talks to:
 * - `panel_*` — every panel action; reads and safe writes run as that person at once, the rest
 *   become a confirmation button that only a press runs;
 * - `offer_buttons` — quick replies and links to panel pages under the answer;
 * - `send_chart` — a metric chart under the answer.
 * Offered only while answering in a dialog (`scope: conversation`).
 */
@Injectable()
export class PanelTools implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly panel: PanelActions,
    private readonly buttons: MessageActionsService,
    private readonly actor: UserActor,
    private readonly accountDb: AccountDb,
    private readonly conversations: ConversationsRepository,
  ) {}

  onModuleInit(): void {
    for (const action of this.panel.all()) {
      this.registry.register(
        defineTool({
          id: `panel_${action.id}`,
          title: `Панель: ${action.id}`,
          description: `${action.description} ${
            action.kind === 'read'
              ? '(reads data as the person)'
              : action.confirm
                ? '(the person confirms with a button under your answer; tell them so)'
                : '(done at once as the person)'
          }`,
          kind: 'platform',
          audience: ['manager'],
          risk: 'low',
          mutating: false,
          scope: 'conversation',
          schema: action.schema,
          standalone: (ctx, args) => this.runPanel(ctx, action.id, args),
        }),
      );
    }

    this.registry.register(
      defineTool({
        id: 'offer_buttons',
        title: 'Кнопки под ответом',
        description:
          "Add up to 6 buttons under your answer: `reply` sends its text as the person's next message (choices, «Показать», «Позже»); `url` opens a page of the panel.",
        kind: 'platform',
        audience: ['manager', 'agent'],
        risk: 'low',
        mutating: false,
        scope: 'conversation',
        schema: offerButtonsSchema,
        standalone: async (ctx, args) => {
          const messageId = this.reply(ctx);
          let added = 0;
          await this.inAccount(ctx, async () => {
            for (const item of args.buttons) {
              const row = await this.buttons.add({
                messageId,
                kind: item.url ? 'link' : 'reply',
                label: item.label,
                payload: item.url ? { url: item.url } : { text: item.reply! },
              });
              if (row) added += 1;
            }
          });
          return { added, skipped: args.buttons.length - added };
        },
      }),
    );

    this.registry.register(
      defineTool({
        id: 'send_chart',
        title: 'График метрики',
        description:
          'Attach a chart of an official metric (metricKey from panel_list_metrics) for 7/30/90 days to your answer.',
        kind: 'platform',
        audience: ['manager', 'agent'],
        risk: 'low',
        mutating: false,
        scope: 'conversation',
        schema: sendChartSchema,
        standalone: async (ctx, args) => {
          const messageId = this.reply(ctx);
          return this.accountDb.transaction(async (tx) => {
            const metric = await tx.db
              .selectFrom('metric_definitions')
              .select(['id', 'title'])
              .where('project_id', '=', ctx.projectId)
              .where('key', '=', args.metricKey)
              .executeTakeFirst();
            if (!metric) throw new ToolError('METRIC_UNKNOWN');
            await this.conversations.addCard(tx.db, messageId, {
              type: 'chart',
              id: metric.id,
              days: args.days,
            });
            return { attached: metric.title };
          });
        },
      }),
    );
  }

  private reply(ctx: ToolContext): string {
    if (!ctx.replyMessageId || !ctx.conversationId) throw new ToolError('NOT_IN_CONVERSATION');
    return ctx.replyMessageId;
  }

  private inAccount<T>(ctx: ToolContext, fn: () => Promise<T>): Promise<T> {
    return this.actor.run(
      {
        userId: ctx.userId ?? '',
        accountId: ctx.accountId,
        role: 'viewer',
        projectId: ctx.projectId,
      },
      fn,
    );
  }

  private async runPanel(
    ctx: ToolContext,
    actionId: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const action = this.panel.get(actionId);
    if (!action) throw new ToolError('UNKNOWN_ACTION');
    if (!ctx.userId) throw new ToolError('NO_PERSON');
    const messageId = this.reply(ctx);
    const role = await this.actor.accountRole(ctx.userId, ctx.accountId);
    if (!role) throw new ToolError('NO_PERSON');
    // The person's role decides, not the manager's: a viewer's manager cannot hire.
    if (!this.panel.allowed(action, role)) {
      return { status: 'forbidden', reason: `the person's role (${role}) cannot do this` };
    }
    const acting = { userId: ctx.userId, accountId: ctx.accountId, role, projectId: ctx.projectId };
    if (action.confirm) {
      const summary = await this.actor.run(acting, () => action.describe!(args));
      const row = await this.inAccount(ctx, () =>
        this.buttons.add({
          messageId,
          kind: 'action',
          label: summary.slice(0, 64),
          payload: { actionId, args, summary },
        }),
      );
      if (!row) throw new ToolError('TOO_MANY_BUTTONS');
      return { status: 'awaiting_confirmation', button: row.label };
    }
    try {
      const result = await this.actor.run(acting, () => action.run(args));
      if (result.url) {
        await this.inAccount(ctx, () =>
          this.buttons.add({
            messageId,
            kind: 'link',
            label: result.text.slice(0, 64),
            payload: { url: result.url! },
            trusted: true,
          }),
        );
      }
      return { status: 'done', text: result.text, data: result.data, link: Boolean(result.url) };
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'FAILED';
      return { status: 'failed', code };
    }
  }
}
