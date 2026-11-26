import type { Request, Response } from 'express';
import { z } from 'zod';

import { readCookie } from './auth-cookie.js';

export const workspaceCookie = 'geniebox_workspace';

export function readWorkspace(request: Request, userId: string) {
  const [principal, id] = readCookie(request, workspaceCookie)?.split('.') ?? [];
  return principal === userId ? z.uuid().safeParse(id).data : undefined;
}

export function selectWorkspace(response: Response, secure: boolean, userId: string, id: string) {
  response.cookie(workspaceCookie, `${userId}.${id}`, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/api',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}
