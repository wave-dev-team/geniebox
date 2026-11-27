import { projectSchema, workspaceMembersSchema, workspaceSchema } from '@workspace/types';

import { authenticated } from './authenticated.js';

const base = '/v1/accounts';
export const accountPath = (id: string) => `${base}/${encodeURIComponent(id)}`;
export const projectPath = (id: string, project: string) =>
  `${accountPath(id)}/projects/${encodeURIComponent(project)}`;
const json = (method: string, body: object) => ({ method, body: JSON.stringify(body) });

export const accountsApi = {
  list: async (signal?: AbortSignal) =>
    workspaceSchema.array().parse(await (await authenticated(base, { signal })).json()),
  create: async (name: string) =>
    workspaceSchema.parse(await (await authenticated(base, json('POST', { name }))).json()),
  rename: (id: string, name: string) => authenticated(accountPath(id), json('PATCH', { name })),
  members: async (id: string, signal?: AbortSignal) =>
    workspaceMembersSchema.parse(
      await (await authenticated(`${accountPath(id)}/members`, { signal })).json(),
    ),
  invite: (id: string, email: string, role: string) =>
    authenticated(`${accountPath(id)}/invitations`, json('POST', { email, role })),
  join: async (token: string) =>
    workspaceSchema.parse(
      await (await authenticated('/v1/invitations/accept', json('POST', { token }))).json(),
    ),
  projects: async (id: string, signal?: AbortSignal) =>
    projectSchema
      .array()
      .parse(await (await authenticated(`${accountPath(id)}/projects`, { signal })).json()),
  createProject: async (id: string, name: string) =>
    projectSchema.parse(
      await (await authenticated(`${accountPath(id)}/projects`, json('POST', { name }))).json(),
    ),
};
