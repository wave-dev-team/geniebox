import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import type { CheckReason, CheckResult } from './provider.types.js';

/**
 * Outbound calls to hosts the user typed in (Grafana, GitLab, own API, databases, SSH).
 * Private, loopback and link-local destinations are refused unless explicitly allowed (dev),
 * so a connection cannot be used to probe our own network (SSRF).
 * Known limitation: resolution and connection are separate steps (DNS rebinding window); the
 * egress proxy of the tool executor closes it.
 */
const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['::ffff:0:0', 96],
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv6');
}

export class EgressError extends Error {
  constructor(readonly reason: CheckReason) {
    super(reason);
  }
}

export async function assertPublicHost(host: string, allowPrivate: boolean): Promise<void> {
  if (allowPrivate) return;
  const bare = host.replace(/^\[|\]$/g, '');
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = isIP(bare) ? [{ address: bare, family: isIP(bare) }] : await lookup(bare, { all: true });
  } catch {
    throw new EgressError('UNREACHABLE');
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) => PRIVATE.check(address, family === 6 ? 'ipv6' : 'ipv4'))
  ) {
    throw new EgressError('PRIVATE_HOST');
  }
}

export interface ProbeResponse {
  status: number;
  body: unknown;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestInitOptions {
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  checkHost: boolean;
  allowPrivate: boolean;
}

/** HTTP request with timeout and no redirects (a redirect could lead to a private host). */
export async function request(url: string, init: RequestInitOptions): Promise<ProbeResponse> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new EgressError('BAD_RESPONSE');
  }
  if (init.checkHost) {
    await assertPublicHost(parsed.hostname, init.allowPrivate);
  }
  const method = init.method ?? 'GET';
  const hasBody = init.body !== undefined && method !== 'GET';
  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': 'Geniebox/1.0',
    ...(hasBody ? { 'content-type': 'application/json' } : {}),
    ...init.headers,
  };
  let response: Response;
  try {
    response = await fetch(parsed, {
      method,
      headers,
      body: hasBody ? (typeof init.body === 'string' ? init.body : JSON.stringify(init.body)) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(init.timeoutMs),
    });
  } catch (error) {
    throw new EgressError(
      error instanceof Error && error.name === 'TimeoutError' ? 'TIMEOUT' : 'UNREACHABLE',
    );
  }
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Non-JSON bodies are passed as text.
  }
  return { status: response.status, body };
}

/** GET with a timeout, no redirects (a redirect could lead to a private host). */
export function probe(
  url: string,
  init: {
    headers?: Record<string, string>;
    timeoutMs: number;
    checkHost: boolean;
    allowPrivate: boolean;
  },
): Promise<ProbeResponse> {
  return request(url, { ...init, method: 'GET' });
}

/** Common mapping of HTTP statuses to check results. */
export function httpResult(status: number, okDetail?: string): CheckResult {
  if (status >= 200 && status < 300) return { status: 'ok', detail: okDetail };
  if (status === 401 || status === 403) return { status: 'error', reason: 'UNAUTHORIZED' };
  if (status === 404) return { status: 'error', reason: 'NOT_FOUND' };
  return { status: 'error', reason: 'BAD_RESPONSE', detail: `HTTP ${status}` };
}

export function failure(error: unknown): CheckResult {
  if (error instanceof EgressError) return { status: 'error', reason: error.reason };
  return { status: 'error', reason: 'CHECK_FAILED' };
}
