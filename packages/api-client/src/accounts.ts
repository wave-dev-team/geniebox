import { workspaceDirectorySchema, workspaceMembersSchema } from '@workspace/types';

import { authenticated } from './authenticated.js';

const base = '/v1/accounts';

export const accountsApi = {
  list: async (signal?: AbortSignal) =>
    workspaceDirectorySchema.parse(await (await authenticated(base, { signal })).json()),
  members: async (signal?: AbortSignal) =>
    workspaceMembersSchema.parse(await (await authenticated(`${base}/current/members`, { signal })).json()),
  select: (id: string) => authenticated(`${base}/${encodeURIComponent(id)}/select`, { method: 'POST' }),
  rename: (name: string) =>
    authenticated(`${base}/current`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  invite: (email: string) =>
    authenticated(`${base}/current/invitations`, { method: 'POST', body: JSON.stringify({ email }) }),
  join: (code: string) => authenticated(`${base}/join`, { method: 'POST', body: JSON.stringify({ code }) }),
};
