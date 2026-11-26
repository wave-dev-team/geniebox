import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

// Accept upstream ids only in a safe shape so they cannot inject into logs or headers.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Resolves the request id once per request and pins it to the request headers, so every
 * middleware that calls it (CLS, pino-http) sees the same value regardless of order.
 */
export function resolveRequestId(req: IncomingMessage, res?: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const id = candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
  req.headers[REQUEST_ID_HEADER] = id;
  if (res && !res.headersSent) {
    res.setHeader(REQUEST_ID_HEADER, id);
  }
  return id;
}
