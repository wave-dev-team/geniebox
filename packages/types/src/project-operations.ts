import { z } from 'zod';

export const permissionModes = ['auto', 'notify', 'approve', 'deny'] as const;
export type PermissionMode = (typeof permissionModes)[number];

export const projectAgentSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['manager', 'agent']),
  displayName: z.string(),
});

export const projectAgentDetailsSchema = projectAgentSchema.extend({
  permissions: z.array(
    z.object({
      actionId: z.string(),
      mode: z.enum(permissionModes),
      source: z.enum(['preset', 'explicit', 'system']),
      locked: z.boolean(),
    }),
  ),
});

export const projectConnectionSchema = z.object({
  id: z.uuid(),
  providerKey: z.string(),
  name: z.string(),
  config: z.record(z.string(), z.string()),
  status: z.enum(['pending', 'ok', 'warn', 'error']),
  credential: z
    .object({
      masked: z.string(),
      updatedAt: z.string(),
      expiresAt: z.string().nullable(),
      health: z.enum(['ok', 'expiring', 'expired']),
    })
    .nullable(),
});

export const connectionProviderSchema = z.object({
  key: z.string(),
  sshKey: z.boolean(),
  accessLevels: z.array(z.enum(['read', 'read_write'])),
  fields: z.array(
    z.object({
      key: z.string(),
      kind: z.enum(['secret', 'text', 'url', 'host', 'port', 'select']),
      required: z.boolean(),
      options: z.array(z.string()).nullable(),
      defaultValue: z.string().nullable(),
    }),
  ),
});

export const onboardingAgentCatalogSchema = z.object({
  templates: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      role: z.string(),
      short: z.string(),
      listed: z.boolean(),
      onboarding: z.object({ offered: z.boolean(), goals: z.array(z.string()) }),
    }),
  ),
});

export type ConnectionProvider = z.infer<typeof connectionProviderSchema>;

export const journalResults = ['ok', 'approval', 'refused', 'failed'] as const;
export const journalPeriods = ['today', '7d', '30d'] as const;
export type JournalFilters = {
  agentId?: string;
  connectionId?: string;
  result?: (typeof journalResults)[number];
  period: (typeof journalPeriods)[number];
};

export const projectJournalSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      at: z.string(),
      agentId: z.uuid(),
      toolId: z.string(),
      details: z.string(),
      status: z.string(),
      connectionId: z.uuid().nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
});

export type ProjectConnection = z.infer<typeof projectConnectionSchema>;
export type ProjectAgentDetails = z.infer<typeof projectAgentDetailsSchema>;
