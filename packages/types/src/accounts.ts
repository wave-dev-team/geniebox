import { z } from 'zod';

export const workspaceRoleSchema = z.enum(['owner', 'member']);
export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: workspaceRoleSchema,
});

export const workspaceNameSchema = z.strictObject({ name: z.string().trim().min(1).max(120) });
export const workspaceInviteSchema = z.strictObject({ email: z.email().max(254) });
export const workspaceJoinSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^[\w-]{43}$/),
});

export type Workspace = z.infer<typeof workspaceSchema>;

export const workspaceDirectorySchema = z.object({
  activeId: z.uuid(),
  workspaces: z.array(workspaceSchema),
});

export const workspaceMembersSchema = z.array(
  z.object({
    id: z.uuid(),
    name: z.string(),
    role: workspaceRoleSchema,
  }),
);
