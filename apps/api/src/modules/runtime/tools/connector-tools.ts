import { Client as PgClient } from 'pg';
import { z } from 'zod';

import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../../config/env.schema.js';
import { ConnectionSecrets, type OpenedConnection } from '../../connections/connection-secrets.js';
import { ProviderHttp } from '../../connections/providers/provider-http.js';
import { defineTool, type ToolExecution } from '../broker/broker.types.js';
import { ToolError } from '../broker/tool-executor.js';
import { ToolRegistry } from '../broker/tool-registry.js';

const MAX_RESPONSE_CHARS = 10_000;
const MAX_DB_ROWS = 100;
const DB_STATEMENT_TIMEOUT_MS = 5_000;

const queryValue = z.union([z.string(), z.number(), z.boolean()]);
const pathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((p) => p.startsWith('/') && !p.includes('..') && !p.includes('://'), {
    message: 'path must be relative and start with /',
  });

const apiReadSchema = z
  .object({
    path: pathSchema,
    query: z.record(z.string().min(1).max(80), queryValue).optional(),
    connectionId: z.uuid().optional(),
  })
  .strict();

const apiCallSchema = z
  .object({
    method: z.enum(['POST', 'PUT', 'PATCH', 'DELETE']),
    path: pathSchema,
    query: z.record(z.string().min(1).max(80), queryValue).optional(),
    body: z.unknown().optional(),
    connectionId: z.uuid().optional(),
  })
  .strict();

const dbQuerySchema = z
  .object({
    sql: z.string().trim().min(1).max(4_000),
    params: z
      .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .max(20)
      .optional(),
    connectionId: z.uuid().optional(),
  })
  .strict();

const webFetchSchema = z
  .object({
    url: z.url().max(1_000),
  })
  .strict();

const FORBIDDEN_SQL =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|CALL|DO|EXECUTE|MERGE|VACUUM|LOCK)\b/i;

/**
 * Validates that a SQL string is a single read-only SELECT or WITH statement.
 * Throws ToolError('READ_ONLY_SQL') if any mutation or multi-statement pattern is detected.
 */
export function assertReadOnlySql(raw: string): string {
  const cleaned = raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim()
    .replace(/;+$/, '')
    .trim();
  if (!cleaned || cleaned.includes(';')) throw new ToolError('READ_ONLY_SQL');
  if (!/^(SELECT|WITH)\b/i.test(cleaned)) throw new ToolError('READ_ONLY_SQL');
  if (FORBIDDEN_SQL.test(cleaned)) throw new ToolError('READ_ONLY_SQL');
  return cleaned;
}

function buildConnectionUrl(
  connection: OpenedConnection,
  path: string,
  query?: Record<string, string | number | boolean>,
): { url: string; headers: Record<string, string>; checkHost: boolean } {
  if (connection.providerKey === 'yandex_metrika') {
    const url = new URL(path, 'https://api-metrika.yandex.net');
    if (query) {
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    }
    if (!url.searchParams.has('ids') && connection.config.counter_id) {
      url.searchParams.set('ids', connection.config.counter_id);
    }
    return {
      url: url.toString(),
      headers: { authorization: `OAuth ${connection.secret.oauth_token ?? ''}` },
      checkHost: false,
    };
  }
  const base = (connection.config.url ?? '').replace(/\/+$/, '');
  if (!base) throw new ToolError('CONNECTION_MISCONFIGURED');
  const url = new URL(`${base}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  }
  return {
    url: url.toString(),
    headers: connection.secret.token ? { authorization: `Bearer ${connection.secret.token}` } : {},
    checkHost: true,
  };
}

function truncateBody(body: unknown): unknown {
  if (typeof body === 'string') return body.slice(0, MAX_RESPONSE_CHARS);
  const json = JSON.stringify(body);
  if (json.length <= MAX_RESPONSE_CHARS) return body;
  return { truncated: true, preview: json.slice(0, MAX_RESPONSE_CHARS) };
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Universal connector tools: `api.read`, `api.call`, `db.query`, `web.fetch`.
 * Domain-specific API paths, SQL queries and metrics are chosen by the agent;
 * credentials, host checks and read-only/approval invariants are enforced here.
 */
@Injectable()
export class ConnectorTools implements OnModuleInit {
  private readonly timeoutMs: number;
  private readonly allowPrivate: boolean;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly secrets: ConnectionSecrets,
    private readonly http: ProviderHttp,
    config: ConfigService<Env, true>,
  ) {
    this.timeoutMs = config.get('CONNECTION_CHECK_TIMEOUT_MS', { infer: true });
    this.allowPrivate = config.get('CONNECTIONS_ALLOW_PRIVATE_HOSTS', { infer: true });
  }

  onModuleInit(): void {
    const tools = [
      defineTool({
        id: 'api.read',
        title: 'Читать данные через API',
        description:
          'Perform a read-only GET request against a connected HTTP API or Yandex Metrika. Pass relative path and optional query parameters; authorization is attached by the broker.',
        kind: 'catalog',
        audience: ['agent'],
        risk: 'low',
        mutating: false,
        providers: ['http_api', 'yandex_metrika'],
        schema: apiReadSchema,
        execute: (ctx, args) => this.apiRequest(ctx, 'GET', args.path, args.query),
      }),
      defineTool({
        id: 'api.call',
        title: 'Вызывать действия API',
        description:
          'Perform a mutating HTTP request (POST/PUT/PATCH/DELETE) against a connected HTTP API. Requires approval when policy demands it.',
        kind: 'catalog',
        audience: ['agent'],
        risk: 'medium',
        mutating: true,
        providers: ['http_api'],
        schema: apiCallSchema,
        execute: (ctx, args) => this.apiRequest(ctx, args.method, args.path, args.query, args.body),
      }),
      defineTool({
        id: 'db.query',
        title: 'Запросы к базе в песочнице',
        description:
          'Execute a read-only SQL query (SELECT or WITH) against a connected PostgreSQL database. Returns up to 100 rows.',
        kind: 'catalog',
        audience: ['agent'],
        risk: 'low',
        mutating: false,
        providers: ['postgres'],
        schema: dbQuerySchema,
        execute: (ctx, args) => this.dbQuery(ctx, args),
      }),
      defineTool({
        id: 'web.fetch',
        title: 'Прочитать веб-страницу',
        description:
          'Fetch a public web page (storefront, product card, documentation) and return its cleaned text.',
        kind: 'platform',
        audience: ['agent', 'manager'],
        risk: 'low',
        mutating: false,
        schema: webFetchSchema,
        execute: (_ctx, args) => this.webFetch(args.url),
      }),
    ];
    for (const tool of tools) this.registry.register(tool);
  }

  private async apiRequest(
    ctx: ToolExecution,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    query?: Record<string, string | number | boolean>,
    body?: unknown,
  ) {
    const connection = ctx.connectionId ? await this.secrets.open(ctx.connectionId) : undefined;
    if (!connection) throw new ToolError('SECRET_UNAVAILABLE');
    const target = buildConnectionUrl(connection, path, query);
    const response = await this.http
      .request(target.url, {
        method,
        headers: target.headers,
        body,
        timeoutMs: this.timeoutMs,
        checkHost: target.checkHost,
        allowPrivate: this.allowPrivate,
      })
      .catch(() => {
        throw new ToolError('PROVIDER_UNREACHABLE');
      });
    if (response.status >= 400) throw new ToolError(`PROVIDER_HTTP_${response.status}`);
    return { status: response.status, data: truncateBody(response.body) };
  }

  private async dbQuery(ctx: ToolExecution, args: z.infer<typeof dbQuerySchema>) {
    const sql = assertReadOnlySql(args.sql);
    const connection = ctx.connectionId ? await this.secrets.open(ctx.connectionId) : undefined;
    if (!connection) throw new ToolError('SECRET_UNAVAILABLE');
    const client = new PgClient({
      host: connection.config.host,
      port: Number(connection.config.port || 5432),
      database: connection.config.database,
      user: connection.config.username,
      password: connection.secret.password,
      ssl: connection.config.ssl === 'disable' ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: this.timeoutMs,
      statement_timeout: DB_STATEMENT_TIMEOUT_MS,
    });
    try {
      await client.connect();
      await client.query('BEGIN READ ONLY');
      const result = await client.query(sql, args.params);
      await client.query('COMMIT');
      const rows = result.rows.slice(0, MAX_DB_ROWS);
      return {
        rowCount: result.rowCount ?? rows.length,
        truncated: result.rows.length > MAX_DB_ROWS,
        rows,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof ToolError) throw error;
      throw new ToolError('DB_QUERY_FAILED');
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async webFetch(url: string) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new ToolError('INVALID_URL');
    }
    const response = await this.http
      .get(url, {
        timeoutMs: this.timeoutMs,
        checkHost: true,
        allowPrivate: this.allowPrivate,
      })
      .catch(() => {
        throw new ToolError('FETCH_FAILED');
      });
    if (response.status >= 400) throw new ToolError(`HTTP_${response.status}`);
    const raw = typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
    const text = stripHtml(raw).slice(0, 8_000);
    return { url, status: response.status, text };
  }
}
