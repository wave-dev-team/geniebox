import type { CookieOptions, Request, Response } from 'express';

import { ACCESS_SECONDS } from '../../modules/auth/session.store.js';

export const ACCESS_COOKIE = 'geniebox_access';
const refreshCookie = 'geniebox_refresh';

export function readCookie(request: Request, name: string) {
  return request.headers.cookie
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export function readRefreshCookie(request: Request) {
  return readCookie(request, refreshCookie) ?? '';
}

function settings(secure: boolean, path: string): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'lax', path };
}

export function setAuthCookies(
  response: Response,
  secure: boolean,
  { access, refresh, expiresIn }: { access: string; refresh: string; expiresIn: number },
) {
  response.cookie(ACCESS_COOKIE, access, { ...settings(secure, '/api'), maxAge: ACCESS_SECONDS * 1000 });
  response.cookie(refreshCookie, refresh, { ...settings(secure, '/api/v1/auth'), maxAge: expiresIn * 1000 });
}

export function clearAuthCookies(response: Response, secure: boolean) {
  response.clearCookie(ACCESS_COOKIE, settings(secure, '/api'));
  response.clearCookie(refreshCookie, settings(secure, '/api/v1/auth'));
}
