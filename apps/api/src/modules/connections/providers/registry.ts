import { Client as PgClient } from 'pg';

import { assertPublicHost, failure, httpResult, probe } from './egress.js';
import type { CheckContext, CheckResult, ProviderDefinition } from './provider.types.js';
import { checkSsh } from './ssh.js';

const URL_FIELD = { key: 'url', kind: 'url', required: true, maxLength: 300 } as const;
const HOST_FIELD = { key: 'host', kind: 'host', required: true, maxLength: 253 } as const;

function trimUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

async function httpCheck(
  context: CheckContext,
  url: string,
  headers: Record<string, string | undefined>,
  userHost: boolean,
  detailOf?: (body: unknown) => CheckResult | undefined,
): Promise<CheckResult> {
  try {
    const clean = Object.fromEntries(
      Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    const response = await probe(url, {
      headers: clean,
      timeoutMs: context.timeoutMs,
      checkHost: userHost,
      allowPrivate: context.allowPrivateHosts,
    });
    const result = httpResult(response.status);
    return result.status === 'ok' ? (detailOf?.(response.body) ?? result) : result;
  } catch (error) {
    return failure(error);
  }
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, 100) : undefined;

/**
 * Catalog of providers. Code, not a table:
 * each provider brings its own check. Texts (titles, what agents see/can/cannot, field labels,
 * instructions) live in the frontend i18n under the provider key.
 */
export const PROVIDERS: readonly ProviderDefinition[] = [
  {
    key: 'telegram_bot',
    category: 'bot_crm',
    accessLevels: ['read', 'read_write'],
    maskField: 'token',
    fields: [{ key: 'token', kind: 'secret', required: true, pattern: /^\d{5,12}:[A-Za-z0-9_-]{30,50}$/ }],
    check: (c) =>
      httpCheck(c, `https://api.telegram.org/bot${c.secret.token}/getMe`, {}, false, (body) => {
        const username = str((body as { result?: { username?: unknown } }).result?.username);
        return { status: 'ok', configPatch: username ? { username } : undefined };
      }),
  },
  {
    key: 'yookassa',
    category: 'payments',
    accessLevels: ['read'],
    maskField: 'secret_key',
    fields: [
      { key: 'shop_id', kind: 'text', required: true, pattern: /^\d{3,12}$/ },
      { key: 'secret_key', kind: 'secret', required: true, maxLength: 200 },
    ],
    check: (c) =>
      httpCheck(
        c,
        'https://api.yookassa.ru/v3/me',
        {
          authorization: `Basic ${Buffer.from(`${c.config.shop_id}:${c.secret.secret_key}`).toString('base64')}`,
        },
        false,
      ),
  },
  {
    key: 'yandex_metrika',
    category: 'site_analytics',
    accessLevels: ['read'],
    maskField: 'oauth_token',
    fields: [
      { key: 'counter_id', kind: 'text', required: true, pattern: /^\d{3,12}$/ },
      { key: 'oauth_token', kind: 'secret', required: true, maxLength: 200 },
    ],
    check: (c) =>
      httpCheck(
        c,
        `https://api-metrika.yandex.net/management/v1/counter/${c.config.counter_id}`,
        { authorization: `OAuth ${c.secret.oauth_token}` },
        false,
        (body) => {
          const site = str((body as { counter?: { site?: unknown } }).counter?.site);
          return { status: 'ok', configPatch: site ? { site } : undefined };
        },
      ),
  },
  {
    key: 'gitlab',
    category: 'code',
    accessLevels: ['read', 'read_write'],
    maskField: 'token',
    fields: [URL_FIELD, { key: 'token', kind: 'secret', required: true, maxLength: 200 }],
    check: (c) =>
      httpCheck(c, `${trimUrl(c.config.url ?? '')}/api/v4/user`, { 'private-token': c.secret.token }, true),
  },
  {
    key: 'grafana',
    category: 'servers',
    accessLevels: ['read'],
    maskField: 'token',
    fields: [URL_FIELD, { key: 'token', kind: 'secret', required: true, maxLength: 300 }],
    check: (c) =>
      httpCheck(
        c,
        `${trimUrl(c.config.url ?? '')}/api/org`,
        { authorization: `Bearer ${c.secret.token}` },
        true,
      ),
  },
  {
    key: 'ssh_server',
    category: 'servers',
    accessLevels: ['read', 'read_write'],
    sshKey: true,
    fields: [
      HOST_FIELD,
      { key: 'port', kind: 'port', required: false, defaultValue: '22' },
      { key: 'username', kind: 'text', required: true, pattern: /^[a-z_][a-z0-9_.-]{0,31}$/i },
    ],
    check: checkSsh,
  },
  {
    key: 'postgres',
    category: 'database',
    accessLevels: ['read'],
    maskField: 'password',
    fields: [
      HOST_FIELD,
      { key: 'port', kind: 'port', required: false, defaultValue: '5432' },
      { key: 'database', kind: 'text', required: true, maxLength: 63 },
      { key: 'username', kind: 'text', required: true, maxLength: 63 },
      { key: 'password', kind: 'secret', required: true, maxLength: 200 },
      {
        key: 'ssl',
        kind: 'select',
        required: false,
        options: ['require', 'disable'],
        defaultValue: 'require',
      },
    ],
    check: async (c: CheckContext): Promise<CheckResult> => {
      try {
        await assertPublicHost(c.config.host ?? '', c.allowPrivateHosts);
      } catch (error) {
        return failure(error);
      }
      const client = new PgClient({
        host: c.config.host,
        port: Number(c.config.port || 5432),
        database: c.config.database,
        user: c.config.username,
        password: c.secret.password,
        ssl: c.config.ssl === 'disable' ? false : { rejectUnauthorized: false },
        connectionTimeoutMillis: c.timeoutMs,
        statement_timeout: c.timeoutMs,
      });
      try {
        await client.connect();
        await client.query('SELECT 1');
        return { status: 'ok' };
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === '28P01' || code === '28000') return { status: 'error', reason: 'UNAUTHORIZED' };
        if (code === '3D000') return { status: 'error', reason: 'NOT_FOUND' };
        return { status: 'error', reason: 'UNREACHABLE' };
      } finally {
        await client.end().catch(() => undefined);
      }
    },
  },
  {
    key: 'http_api',
    category: 'database',
    accessLevels: ['read', 'read_write'],
    maskField: 'token',
    fields: [URL_FIELD, { key: 'token', kind: 'secret', required: true, maxLength: 500 }],
    check: (c) => httpCheck(c, c.config.url ?? '', { authorization: `Bearer ${c.secret.token}` }, true),
  },
];

const BY_KEY = new Map(PROVIDERS.map((provider) => [provider.key, provider]));

export function findProvider(key: string): ProviderDefinition | undefined {
  return BY_KEY.get(key);
}
