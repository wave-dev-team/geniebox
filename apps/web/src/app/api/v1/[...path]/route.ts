import { NextRequest, NextResponse } from 'next/server';

const issueSession = new Set(['auth/register', 'auth/login', 'auth/email-code/verify', 'auth/refresh']);
const publicActions = new Set([
  ...issueSession,
  'auth/email-code',
  'auth/password/forgot',
  'auth/password/reset',
]);
const privateActions = new Set([
  'auth/email/verification',
  'auth/email/verification/confirm',
  'auth/password/change',
  'auth/logout',
  'auth/logout-all',
]);
const uuid = '[0-9a-fA-F-]{36}';
const account = `accounts/${uuid}`;
const project = `${account}/projects/${uuid}`;
const resources = new RegExp(
  `^(?:me(?:/sessions(?:/${uuid})?|/projects)?|accounts|${account}(?:/members(?:/${uuid})?|/invitations(?:/${uuid})?|/ownership|/projects)?|invitations/accept|connection-providers|agent-catalog|${project}(?:/(?:stream|conversations(?:/manager|/${uuid}/messages)?|rules|pause|resume|onboarding/complete|agents(?:/${uuid}(?:/(?:permissions|actions|stats|pause|resume|rules|connections))?)?|tasks(?:/${uuid}(?:/(?:run|cancel))?)?|task-counts|routines(?:/${uuid}(?:/run)?)?|connections(?:/disconnect-all|/import(?:/(?:analyze(?:/${uuid})?|clarify))?|/${uuid}/rotate)?|journal(?:\\.csv)?|knowledge(?:/(?:nodes(?:/${uuid}(?:/(?:publish|archive|restore|revisions(?:/\\d{1,4}/restore)?))?)?|sources(?:/${uuid}/retry)?|search|proposals(?:/${uuid}/(?:accept|reject))?|stats))?))?)$`,
);
const chatReadResources = new RegExp(
  `^${project}/(?:tasks/${uuid}|decisions/${uuid}|metrics(?:/${uuid}/series)?)$`,
);
const contextReset = new RegExp(`^${account}/manager-context/(?:me/)?reset$`);
const chatActions = new RegExp(
  `^${project}/(?:message-actions/${uuid}/press|decisions/${uuid}/(?:accept|reject))$`,
);
const connectLink = /^connect\/[A-Za-z0-9_-]{8,128}$/;
const accessCookie = 'geniebox-access';
const refreshCookie = 'geniebox-refresh';

async function proxy(req: NextRequest, context: RouteContext<'/api/v1/[...path]'>) {
  const path = (await context.params).path.join('/');
  const chatResource =
    (req.method === 'GET' && chatReadResources.test(path)) ||
    (req.method === 'POST' && (chatActions.test(path) || contextReset.test(path)));
  if (!(
    resources.test(path) ||
    chatResource ||
    connectLink.test(path) ||
    publicActions.has(path) ||
    privateActions.has(path)
  )) {
    return new Response(null, { status: 404 });
  }
  if (
    req.method !== 'GET' &&
    (req.headers.get('x-geniebox-request') !== '1' || req.headers.get('sec-fetch-site') === 'cross-site')
  ) {
    return new Response(null, { status: 403 });
  }

  const headers = new Headers();
  for (const name of ['accept', 'accept-language', 'user-agent', 'content-type']) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  const access = req.cookies.get(accessCookie)?.value;
  if (!publicActions.has(path)) {
    if (!access) return new Response(null, { status: 401 });
    headers.set('authorization', `Bearer ${access}`);
  }
  let body: string | undefined;
  if (path === 'auth/refresh') {
    const token = req.cookies.get(refreshCookie)?.value;
    if (!token) return new Response(null, { status: 401 });
    body = JSON.stringify({ refreshToken: token });
    headers.set('content-type', 'application/json');
  } else if (req.method !== 'GET') {
    body = (await req.text()) || undefined;
  }
  const base = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000';
  const upstream = await fetch(new URL(`/v1/${path}${req.nextUrl.search}`, base), {
    method: req.method,
    headers,
    body,
    signal: req.signal,
    cache: 'no-store',
    redirect: 'error',
  });
  const resultHeaders = new Headers({ 'Cache-Control': 'no-store' });
  const contentType = upstream.headers.get('content-type');
  if (contentType) resultHeaders.set('content-type', contentType);
  if (contentType?.includes('text/event-stream')) resultHeaders.set('X-Accel-Buffering', 'no');

  // The browser only gets the outcome. Both tokens stay in HTTP-only cookies.
  if (upstream.ok && issueSession.has(path)) {
    const tokens = await upstream.json();
    const response = NextResponse.json({ created: tokens.created ?? false }, { headers: resultHeaders });
    const options = { httpOnly: true, sameSite: 'lax' as const, secure: req.nextUrl.protocol === 'https:' };
    response.cookies.set(accessCookie, tokens.accessToken, {
      ...options,
      path: '/api/v1',
      expires: new Date(tokens.accessTokenExpiresAt),
    });
    response.cookies.set(refreshCookie, tokens.refreshToken, {
      ...options,
      path: '/api/v1/auth/refresh',
      expires: new Date(tokens.refreshTokenExpiresAt),
    });
    return response;
  }
  const response = new NextResponse(upstream.body, { status: upstream.status, headers: resultHeaders });
  if (upstream.ok && (path === 'auth/logout' || path === 'auth/logout-all')) {
    response.cookies.set(accessCookie, '', { path: '/api/v1', maxAge: 0 });
    response.cookies.set(refreshCookie, '', { path: '/api/v1/auth/refresh', maxAge: 0 });
  }
  return response;
}

export { proxy as DELETE, proxy as GET, proxy as PATCH, proxy as POST, proxy as PUT };
