import { z } from 'zod';

import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Locale } from '../../../common/i18n/locales.js';
import type { Env } from '../../../config/env.schema.js';
import { ConnectionSecrets } from '../../connections/connection-secrets.js';
import { ProviderHttp } from '../../connections/providers/provider-http.js';
import { MailService } from '../../mail/mail.service.js';
import { defineTool, type ToolExecution } from '../broker/broker.types.js';
import { ToolError } from '../broker/tool-executor.js';
import { ToolRegistry } from '../broker/tool-registry.js';

const notifySchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(2_000),
    channel: z.enum(['auto', 'email', 'telegram']).default('auto'),
    urgency: z.enum(['normal', 'high']).default('normal'),
  })
  .strict();

/**
 * Owner/product manager notification tool (`notify.owner`): routes to Telegram when a
 * `telegram_bot` connection with `chat_id` is configured, or falls back to email via `MailService`.
 */
@Injectable()
export class NotifyTools implements OnModuleInit {
  private readonly timeoutMs: number;
  private readonly appUrl: string;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly secrets: ConnectionSecrets,
    private readonly http: ProviderHttp,
    private readonly mail: MailService,
    config: ConfigService<Env, true>,
  ) {
    this.timeoutMs = config.get('CONNECTION_CHECK_TIMEOUT_MS', { infer: true });
    this.appUrl = config.get('APP_PUBLIC_URL', { infer: true }).replace(/\/+$/, '');
  }

  onModuleInit(): void {
    this.registry.register(
      defineTool({
        id: 'notify.owner',
        title: 'Уведомить владельца',
        description:
          'Send a timely notification to the project owner/product manager via Telegram (if connected) or email.',
        kind: 'platform',
        audience: ['agent', 'manager'],
        risk: 'low',
        mutating: false,
        schema: notifySchema,
        execute: (ctx, args) => this.notify(ctx, args),
      }),
    );
  }

  private async notify(ctx: ToolExecution, args: z.infer<typeof notifySchema>) {
    if (args.channel === 'telegram' || args.channel === 'auto') {
      const tg = await ctx.tx.db
        .selectFrom('connections')
        .select(['id', 'config'])
        .where('project_id', '=', ctx.projectId)
        .where('provider_key', '=', 'telegram_bot')
        .where('status', '!=', 'disconnected')
        .where('deleted_at', 'is', null)
        .executeTakeFirst();

      const tgConfig = tg?.config as Record<string, unknown> | null | undefined;
      const chatId = typeof tgConfig?.chat_id === 'string' ? tgConfig.chat_id : undefined;
      if (tg && chatId) {
        const opened = await this.secrets.open(tg.id);
        const token = opened?.secret.token;
        if (!token) throw new ToolError('SECRET_UNAVAILABLE');
        const prefix = args.urgency === 'high' ? '🚨 ' : '';
        const text = `${prefix}*${args.title}*\n\n${args.message}`;
        const response = await this.http
          .request(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            body: { chat_id: chatId, text, parse_mode: 'Markdown' },
            timeoutMs: this.timeoutMs,
            checkHost: false,
            allowPrivate: false,
          })
          .catch(() => {
            throw new ToolError('PROVIDER_UNREACHABLE');
          });
        if (response.status >= 400) throw new ToolError(`PROVIDER_HTTP_${response.status}`);
        return { delivered: true, channel: 'telegram' };
      }
      if (args.channel === 'telegram') {
        throw new ToolError('TELEGRAM_NOT_CONFIGURED');
      }
    }

    const project = await ctx.tx.db
      .selectFrom('projects')
      .select(['name'])
      .where('id', '=', ctx.projectId)
      .executeTakeFirstOrThrow();

    const recipient = await ctx.tx.db
      .selectFrom('account_members')
      .innerJoin('users', 'users.id', 'account_members.user_id')
      .select(['users.email', 'users.locale'])
      .where('account_members.account_id', '=', ctx.accountId)
      .where('account_members.role', 'in', ['owner', 'admin'])
      .orderBy('account_members.role')
      .executeTakeFirst();

    if (!recipient?.email) throw new ToolError('RECIPIENT_NOT_FOUND');

    const locale: Locale = recipient.locale === 'en' ? 'en' : 'ru';
    await this.mail.send({
      to: recipient.email,
      template: 'agent_alert',
      locale,
      params: {
        project: project.name,
        title: args.title,
        message: args.message,
        link: `${this.appUrl}/projects/${ctx.projectId}`,
      },
    });
    return { delivered: true, channel: 'email', to: recipient.email };
  }
}
