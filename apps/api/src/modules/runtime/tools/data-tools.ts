import { z } from 'zod';

import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../../config/env.schema.js';
import { ConnectionSecrets } from '../../connections/connection-secrets.js';
import { ProviderHttp } from '../../connections/providers/provider-http.js';
import { defineTool, type ToolExecution } from '../broker/broker.types.js';
import { ToolError } from '../broker/tool-executor.js';
import { ToolRegistry } from '../broker/tool-registry.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const periodSchema = z.object({ days: z.number().int().min(1).max(90).default(7) }).strict();

/**
 * Read-only data tools backed by the project's connections. Hosts are fixed provider APIs; credentials are opened only for the call.
 */
@Injectable()
export class DataTools implements OnModuleInit {
  private readonly timeoutMs: number;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly secrets: ConnectionSecrets,
    private readonly http: ProviderHttp,
    config: ConfigService<Env, true>,
  ) {
    this.timeoutMs = config.get('CONNECTION_CHECK_TIMEOUT_MS', { infer: true });
  }

  onModuleInit(): void {
    this.registry.register(
      defineTool({
        id: 'analytics.read',
        title: 'Смотреть аналитику',
        description: 'Site traffic for the last N days from Yandex Metrika: visits, users, bounce rate.',
        kind: 'catalog',
        audience: ['agent'],
        risk: 'low',
        mutating: false,
        providers: ['yandex_metrika'],
        schema: periodSchema,
        execute: (ctx, args) => this.metrika(ctx, args.days),
      }),
    );
    this.registry.register(
      defineTool({
        id: 'payments.read',
        title: 'Смотреть оплаты',
        description: 'Successful payments for the last N days from YooKassa: count and amount (first 100).',
        kind: 'catalog',
        audience: ['agent'],
        risk: 'low',
        mutating: false,
        providers: ['yookassa'],
        schema: periodSchema,
        execute: (ctx, args) => this.yookassa(ctx, args.days),
      }),
    );
  }

  private async metrika(ctx: ToolExecution, days: number) {
    const connection = ctx.connectionId ? await this.secrets.open(ctx.connectionId) : undefined;
    if (!connection) throw new ToolError('SECRET_UNAVAILABLE');
    const url = new URL('https://api-metrika.yandex.net/stat/v1/data');
    url.searchParams.set('ids', connection.config.counter_id ?? '');
    url.searchParams.set('metrics', 'ym:s:visits,ym:s:users,ym:s:bounceRate');
    url.searchParams.set('date1', `${days}daysAgo`);
    url.searchParams.set('date2', 'today');
    const response = await this.http
      .get(url.toString(), {
        headers: { authorization: `OAuth ${connection.secret.oauth_token}` },
        timeoutMs: this.timeoutMs,
        checkHost: false,
        allowPrivate: false,
      })
      .catch(() => {
        throw new ToolError('PROVIDER_UNREACHABLE');
      });
    if (response.status !== 200) throw new ToolError(`PROVIDER_HTTP_${response.status}`);
    const totals = (response.body as { totals?: number[] }).totals ?? [];
    return {
      days,
      visits: Math.round(totals[0] ?? 0),
      users: Math.round(totals[1] ?? 0),
      bounceRatePct: Math.round((totals[2] ?? 0) * 10) / 10,
    };
  }

  private async yookassa(ctx: ToolExecution, days: number) {
    const connection = ctx.connectionId ? await this.secrets.open(ctx.connectionId) : undefined;
    if (!connection) throw new ToolError('SECRET_UNAVAILABLE');
    const url = new URL('https://api.yookassa.ru/v3/payments');
    url.searchParams.set('status', 'succeeded');
    url.searchParams.set('limit', '100');
    url.searchParams.set('created_at.gte', new Date(Date.now() - days * DAY_MS).toISOString());
    const auth = Buffer.from(`${connection.config.shop_id}:${connection.secret.secret_key}`).toString(
      'base64',
    );
    const response = await this.http
      .get(url.toString(), {
        headers: { authorization: `Basic ${auth}` },
        timeoutMs: this.timeoutMs,
        checkHost: false,
        allowPrivate: false,
      })
      .catch(() => {
        throw new ToolError('PROVIDER_UNREACHABLE');
      });
    if (response.status !== 200) throw new ToolError(`PROVIDER_HTTP_${response.status}`);
    const items =
      (response.body as { items?: Array<{ amount?: { value?: string; currency?: string } }> }).items ?? [];
    const amount = items.reduce((sum, item) => sum + Number(item.amount?.value ?? 0), 0);
    return {
      days,
      payments: items.length,
      amount: Math.round(amount),
      currency: items[0]?.amount?.currency ?? 'RUB',
      complete: items.length < 100,
    };
  }
}
