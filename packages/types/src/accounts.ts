import { z } from 'zod';

export const workspaceRoleSchema = z.enum(['owner', 'admin', 'tech', 'viewer']);
export const workspaceSchema = z.object({ id: z.uuid(), name: z.string(), role: workspaceRoleSchema });
export const workspaceMembersSchema = z.array(
  z.object({
    userId: z.uuid(),
    displayName: z.string().nullable(),
    email: z.string(),
    role: workspaceRoleSchema,
    joinedAt: z.string(),
  }),
);
export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: z.enum(['admin', 'tech', 'viewer']),
  invitedBy: z.uuid(),
  createdAt: z.string(),
  expiresAt: z.string(),
  expired: z.boolean(),
});
export const invitationsSchema = z.array(invitationSchema);
export type Workspace = z.infer<typeof workspaceSchema>;
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;
export type AssignableRole = z.infer<typeof invitationSchema>['role'];
export type Member = z.infer<typeof workspaceMembersSchema>[number];
export type Invitation = z.infer<typeof invitationSchema>;
