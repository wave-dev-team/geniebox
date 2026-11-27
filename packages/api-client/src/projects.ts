import {
  invitationsSchema,
  projectSchema,
  type ProjectRulesUpdate,
  type ProjectUpdate,
  workspaceMembersSchema,
} from '@workspace/types';

import { accountPath, projectPath } from './accounts.js';
import { authenticated } from './authenticated.js';

const json = (method: string, body?: object) => ({
  method,
  ...(body ? { body: JSON.stringify(body) } : {}),
});

/** One project with all its settings. `GET …/projects/:id`. */
export const projectsApi = {
  get: async (accountId: string, projectId: string, signal?: AbortSignal) =>
    projectSchema.parse(await (await authenticated(projectPath(accountId, projectId), { signal })).json()),
  update: async (accountId: string, projectId: string, body: ProjectUpdate) =>
    projectSchema.parse(
      await (await authenticated(projectPath(accountId, projectId), json('PATCH', body))).json(),
    ),
  updateRules: async (accountId: string, projectId: string, body: ProjectRulesUpdate) =>
    projectSchema.parse(
      await (
        await authenticated(`${projectPath(accountId, projectId)}/rules`, json('PATCH', body))
      ).json(),
    ),
  pause: async (accountId: string, projectId: string, until?: Date) =>
    projectSchema.parse(
      await (
        await authenticated(
          `${projectPath(accountId, projectId)}/pause`,
          json('POST', until ? { until: until.toISOString() } : {}),
        )
      ).json(),
    ),
  resume: async (accountId: string, projectId: string) =>
    projectSchema.parse(
      await (await authenticated(`${projectPath(accountId, projectId)}/resume`, json('POST'))).json(),
    ),
  remove: (accountId: string, projectId: string, confirmName: string) =>
    authenticated(projectPath(accountId, projectId), json('DELETE', { confirmName })),
};

/** Account members and invitations. */
export const membersApi = {
  list: async (accountId: string, signal?: AbortSignal) =>
    workspaceMembersSchema.parse(
      await (await authenticated(`${accountPath(accountId)}/members`, { signal })).json(),
    ),
  changeRole: (accountId: string, userId: string, role: string) =>
    authenticated(`${accountPath(accountId)}/members/${encodeURIComponent(userId)}`, json('PATCH', { role })),
  remove: (accountId: string, userId: string) =>
    authenticated(`${accountPath(accountId)}/members/${encodeURIComponent(userId)}`, json('DELETE')),
  transferOwnership: (accountId: string, userId: string) =>
    authenticated(`${accountPath(accountId)}/ownership`, json('POST', { userId })),
  invitations: async (accountId: string, signal?: AbortSignal) =>
    invitationsSchema.parse(
      await (await authenticated(`${accountPath(accountId)}/invitations`, { signal })).json(),
    ),
  invite: async (accountId: string, email: string, role: string) =>
    authenticated(`${accountPath(accountId)}/invitations`, json('POST', { email, role })),
  revokeInvitation: (accountId: string, invitationId: string) =>
    authenticated(`${accountPath(accountId)}/invitations/${encodeURIComponent(invitationId)}`, json('DELETE')),
};
