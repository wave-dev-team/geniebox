import { authResultSchema, profileSchema, type ProfileUpdate, sessionsSchema } from '@workspace/types';

import { authenticated } from './authenticated.js';
import { pinWorkspace, request } from './request.js';

const json = (body: object) => JSON.stringify(body);
const post = (path: string, body?: object) =>
  request(`/v1/auth/${path}`, { method: 'POST', body: body && json(body) });
const authenticatedPost = (path: string, body?: object) =>
  authenticated(`/v1/auth/${path}`, { method: 'POST', body: body && json(body) });

async function openSession(path: string, body: object) {
  const result = authResultSchema.parse(await (await post(path, body)).json());
  pinWorkspace();
  return result;
}

export const authApi = {
  register: (body: { email: string; password: string; name: string; locale: string }) =>
    openSession('register', body),
  login: (body: { email: string; password: string }) => openSession('login', body),
  loginWithCode: (body: { email: string; code: string }) => openSession('email-code/verify', body),
  requestLoginCode: (email: string) => post('email-code', { email }),
  forgotPassword: (email: string) => post('password/forgot', { email }),
  resetPassword: (body: { email: string; code: string; newPassword: string }) => post('password/reset', body),
  requestVerification: () => authenticatedPost('email/verification'),
  verifyEmail: (code: string) => authenticatedPost('email/verification/confirm', { code }),
  changePassword: (body: { currentPassword?: string; newPassword: string }) =>
    authenticatedPost('password/change', body),
  logout: () => authenticatedPost('logout'),
  logoutAll: () => authenticatedPost('logout-all'),
};

export const profileApi = {
  me: async (signal?: AbortSignal) => {
    const profile = profileSchema.parse(await (await authenticated('/v1/me', { signal })).json());
    pinWorkspace(profile.tenantId);
    return profile;
  },
  update: async (body: ProfileUpdate) =>
    profileSchema.parse(await (await authenticated('/v1/me', { method: 'PATCH', body: json(body) })).json()),
  sessions: async () => sessionsSchema.parse(await (await authenticated('/v1/me/sessions')).json()),
  revokeSession: (id: string) =>
    authenticated(`/v1/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
