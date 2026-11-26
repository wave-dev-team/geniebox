import type { IncomingMessage, ServerResponse } from 'node:http';

import { describe, expect, it, jest } from '@jest/globals';

import { REQUEST_ID_HEADER, resolveRequestId } from './request-id.js';

function request(id?: string | string[]): IncomingMessage {
  return { headers: id === undefined ? {} : { [REQUEST_ID_HEADER]: id } } as IncomingMessage;
}

describe('resolveRequestId', () => {
  it('keeps a well-formed upstream id and echoes it in the response', () => {
    const setHeader = jest.fn();
    const res = { headersSent: false, setHeader } as unknown as ServerResponse;
    expect(resolveRequestId(request('abcdef123456'), res)).toBe('abcdef123456');
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'abcdef123456');
  });

  it('replaces ids that could inject into logs or headers', () => {
    const id = resolveRequestId(request('bad id\nwith newline'));
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the same id on repeated calls for one request', () => {
    const req = request();
    expect(resolveRequestId(req)).toBe(resolveRequestId(req));
  });
});
