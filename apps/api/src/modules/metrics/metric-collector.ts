import { sql } from 'kysely';
import { Client as PgClient } from 'pg';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema.js';
import { AccountDb } from '../../database/scoped-db.js';
import { ConnectionSecrets, type OpenedConnection } from '../connections/connection-secrets.js';
import { assertPublicHost, EgressError } from '../connections/providers/egress.js';
import { ProviderHttp } from '../connections/providers/provider-http.js';
import { addDays, daysBetween, isIsoDay, todayIn } from './days.js';
import {
  BACKFILL_DAYS,
  METRIC_SOURCES,
  REFRESH_DAYS,
  SQL_MAX_ROWS,
  SQL_TIMEOUT_MS,
  YOOKASSA_MAX_PAGES,
} from './metrics.constants.js';
import { type MetricRow, MetricsRepository, type Point } from './repositories/metrics.repository.js';
import { type PaymentEvent, ResultsRepository } from './repositories/results.repository.js';

const YOOKASSA_API = 'https://api.yookassa.ru/v3';
const METRIKA_API = 'https://api-metrika.yandex.net';

/** A source could not give points; the code is shown to the person under the metric. */
export class MetricSourceError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

interface Range {
  from: string;
  to: string;
}

/**
 * Fetches daily points of one official metric from its connection and stores them (upsert by
 * day, so a repeated run changes nothing). YooKassa payments are kept as raw events first and
 * the points are aggregated from them in the project's time zone.
 */
@Injectable()
export class MetricCollector {
  private readonly timeoutMs: number;
  private readonly allowPrivate: boolean;

  constructor(
    private readonly accountDb: AccountDb,
    private readonly metrics: MetricsRepository,
    private readonly results: ResultsRepository,
    private readonly secrets: ConnectionSecrets,
    private readonly http: ProviderHttp,
    config: ConfigService<Env, true>,
  ) {
    this.timeoutMs = config.get('CONNECTION_CHECK_TIMEOUT_MS', { infer: true });
    this.allowPrivate = config.get('CONNECTIONS_ALLOW_PRIVATE_HOSTS', { infer: true });
  }

  async collect(metric: MetricRow, timezone: string): Promise<number> {
    if (!metric.source || !metric.connection_id) throw new MetricSourceError('NO_SOURCE');
    const connection = await this.secrets.open(metric.connection_id);
    if (!connection) throw new MetricSourceError('SECRET_UNAVAILABLE');
    if (connection.providerKey !== METRIC_SOURCES[metric.source.kind].provider) {
      throw new MetricSourceError('WRONG_CONNECTION');
    }
    const to = todayIn(timezone);
    const range = { from: addDays(to, -(metric.collected_at ? REFRESH_DAYS : BACKFILL_DAYS)), to };
    let points: Point[];
    switch (metric.source.kind) {
      case 'yookassa.revenue':
      case 'yookassa.payments':
        points = await this.payments(metric, connection, range, timezone);
        break;
      case 'metrika.visits':
      case 'metrika.users':
        points = await this.metrika(connection, range, metric.source.kind);
        break;
      case 'postgres.sql':
        points = await this.postgres(connection, range, metric.source.query ?? '');
        break;
      case 'http_api.series':
        points = await this.httpSeries(connection, range, metric.source.path ?? '');
        break;
    }
    await this.accountDb.transaction(async (tx) => {
      await this.metrics.upsertPoints(tx.db, metric.account_id, metric.id, points);
      await this.metrics.update(tx.db, metric.id, {
        collected_at: new Date(),
        attempted_at: new Date(),
        last_error: null,
      });
    });
    return points.length;
  }

  private async payments(
    metric: MetricRow,
    connection: OpenedConnection,
    range: Range,
    timezone: string,
  ): Promise<Point[]> {
    const auth = Buffer.from(`${connection.config.shop_id}:${connection.secret.secret_key}`).toString(
      'base64',
    );
    // A day earlier than the range in UTC: the project's midnight may be before UTC midnight.
    const since = new Date(`${addDays(range.from, -1)}T00:00:00Z`).toISOString();
    let cursor: string | undefined;
    for (let page = 0; page < YOOKASSA_MAX_PAGES; page++) {
      const url = new URL(`${YOOKASSA_API}/payments`);
      url.searchParams.set('status', 'succeeded');
      url.searchParams.set('limit', '100');
      url.searchParams.set('created_at.gte', since);
      if (cursor) url.searchParams.set('cursor', cursor);
      const body = await this.getJson(url.toString(), { authorization: `Basic ${auth}` }, false);
      const data = body as {
        items?: Array<{
          id?: string;
          created_at?: string;
          captured_at?: string;
          amount?: { value?: string; currency?: string };
          payment_method?: { type?: string };
        }>;
        next_cursor?: string;
      };
      const events = (data.items ?? []).flatMap((item): PaymentEvent[] => {
        const at = item.captured_at ?? item.created_at;
        const props: Record<string, string> = {};
        if (item.payment_method?.type) props.method = item.payment_method.type.slice(0, 40);
        const amount = Number(item.amount?.value);
        if (!item.id || !at || !Number.isFinite(amount)) return [];
        return [
          {
            externalId: item.id.slice(0, 120),
            occurredAt: new Date(at),
            amount,
            currency: /^[A-Z]{3}$/.test(item.amount?.currency ?? '') ? item.amount!.currency! : 'RUB',
            props,
          },
        ];
      });
      await this.accountDb.transaction((tx) =>
        this.results.insertPayments(tx.db, metric.account_id, metric.project_id, 'yookassa', events),
      );
      cursor = data.next_cursor;
      if (!cursor) break;
    }

    const value = metric.source?.kind === 'yookassa.revenue' ? sql`sum(amount)` : sql`count(*)`;
    const rows = await this.accountDb.transaction((tx) =>
      sql<{ day: string; value: string }>`
        SELECT to_char(occurred_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day, ${value} AS value
        FROM events
        WHERE project_id = ${metric.project_id}
          AND source = 'yookassa' AND type = 'payment.succeeded'
          AND occurred_at >= (${range.from}::date - 1)::timestamp AT TIME ZONE 'UTC'
          AND (occurred_at AT TIME ZONE ${timezone})::date BETWEEN ${range.from}::date AND ${range.to}::date
        GROUP BY 1
      `.execute(tx.db),
    );
    const byDay = new Map(rows.rows.map((row) => [row.day, Number(row.value)]));
    // A day without payments is a real zero for a flow metric.
    return daysBetween(range.from, range.to).map((day) => ({ day, value: byDay.get(day) ?? 0 }));
  }

  private async metrika(
    connection: OpenedConnection,
    range: Range,
    kind: 'metrika.visits' | 'metrika.users',
  ): Promise<Point[]> {
    const url = new URL(`${METRIKA_API}/stat/v1/data`);
    url.searchParams.set('ids', connection.config.counter_id ?? '');
    url.searchParams.set('metrics', kind === 'metrika.visits' ? 'ym:s:visits' : 'ym:s:users');
    url.searchParams.set('dimensions', 'ym:s:date');
    url.searchParams.set('date1', range.from);
    url.searchParams.set('date2', range.to);
    url.searchParams.set('limit', '400');
    const body = (await this.getJson(
      url.toString(),
      { authorization: `OAuth ${connection.secret.oauth_token}` },
      false,
    )) as { data?: Array<{ dimensions?: Array<{ name?: string }>; metrics?: number[] }> };
    return (body.data ?? []).flatMap((row) => {
      const day = row.dimensions?.[0]?.name;
      const value = row.metrics?.[0];
      return isIsoDay(day) && typeof value === 'number' && Number.isFinite(value)
        ? [{ day, value: Math.round(value) }]
        : [];
    });
  }

  /** The owner's query against the owner's database: read-only, time-boxed, row-capped. */
  private async postgres(connection: OpenedConnection, range: Range, query: string): Promise<Point[]> {
    if (!query.trim()) throw new MetricSourceError('QUERY_EMPTY');
    try {
      await assertPublicHost(connection.config.host ?? '', this.allowPrivate);
    } catch (error) {
      throw new MetricSourceError(error instanceof EgressError ? error.reason : 'UNREACHABLE');
    }
    const client = new PgClient({
      host: connection.config.host,
      port: Number(connection.config.port || 5432),
      database: connection.config.database,
      user: connection.config.username,
      password: connection.secret.password,
      ssl: connection.config.ssl === 'disable' ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: this.timeoutMs,
      statement_timeout: SQL_TIMEOUT_MS,
      application_name: 'geniebox-metrics',
    });
    try {
      await client.connect();
      await client.query('BEGIN READ ONLY');
      await client.query(`SET LOCAL statement_timeout = ${SQL_TIMEOUT_MS}`);
      // Only the parameters the query uses: extra ones are a protocol error.
      const used = Math.max(0, ...[...query.matchAll(/\$(\d)/g)].map((m) => Number(m[1])));
      if (used > 2) throw new MetricSourceError('QUERY_INVALID');
      const result = await client.query<{ day: unknown; value: unknown }>(
        query,
        [range.from, range.to].slice(0, used),
      );
      await client.query('ROLLBACK');
      if (result.rows.length > SQL_MAX_ROWS) throw new MetricSourceError('TOO_MANY_ROWS');
      return result.rows.map((row) => {
        const day =
          row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10);
        const value = Number(row.value);
        if (!isIsoDay(day) || !Number.isFinite(value)) throw new MetricSourceError('BAD_ROWS');
        return { day, value };
      });
    } catch (error) {
      if (error instanceof MetricSourceError) throw error;
      const code = (error as { code?: string }).code;
      if (code === '28P01' || code === '28000') throw new MetricSourceError('UNAUTHORIZED');
      if (code === '57014') throw new MetricSourceError('TIMEOUT');
      if (code === '25006') throw new MetricSourceError('READ_ONLY');
      if (code?.startsWith('42')) throw new MetricSourceError('QUERY_INVALID');
      // No SQLSTATE or a connection class: the database was not reached.
      if (!code || code.startsWith('08')) throw new MetricSourceError('UNREACHABLE');
      throw new MetricSourceError('QUERY_FAILED');
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async httpSeries(connection: OpenedConnection, range: Range, path: string): Promise<Point[]> {
    const base = connection.config.url ?? '';
    const url = new URL(path.replace(/^\/+/, ''), base.endsWith('/') ? base : `${base}/`);
    if (new URL(base).host !== url.host) throw new MetricSourceError('PATH_INVALID');
    url.searchParams.set('from', range.from);
    url.searchParams.set('to', range.to);
    const body = await this.getJson(
      url.toString(),
      { authorization: `Bearer ${connection.secret.token}` },
      true,
    );
    const items = Array.isArray(body)
      ? body
      : Array.isArray((body as { points?: unknown[] }).points)
        ? (body as { points: unknown[] }).points
        : null;
    if (!items || items.length > SQL_MAX_ROWS) throw new MetricSourceError('BAD_RESPONSE');
    return items.map((item) => {
      const { day, value } = item as { day?: unknown; value?: unknown };
      if (!isIsoDay(day) || typeof value !== 'number' || !Number.isFinite(value)) {
        throw new MetricSourceError('BAD_RESPONSE');
      }
      return { day, value };
    });
  }

  private async getJson(url: string, headers: Record<string, string>, checkHost: boolean): Promise<unknown> {
    const response = await this.http
      .get(url, { headers, timeoutMs: this.timeoutMs, checkHost, allowPrivate: this.allowPrivate })
      .catch((error: unknown) => {
        throw new MetricSourceError(error instanceof EgressError ? error.reason : 'UNREACHABLE');
      });
    if (response.status === 401 || response.status === 403) {
      throw new MetricSourceError('UNAUTHORIZED');
    }
    if (response.status !== 200) throw new MetricSourceError(`HTTP_${response.status}`);
    if (typeof response.body !== 'object' || response.body === null) {
      throw new MetricSourceError('BAD_RESPONSE');
    }
    return response.body;
  }
}
