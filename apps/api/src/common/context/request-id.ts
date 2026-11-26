import { randomUUID } from 'node:crypto';

export const requestIdHeader = 'X-Request-Id';

export function newRequestId() {
  return randomUUID();
}
