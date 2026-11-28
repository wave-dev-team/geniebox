import { z } from 'zod';

export const permissionModes = ['auto', 'notify', 'approve', 'deny'] as const;
export type PermissionMode = (typeof permissionModes)[number];

export const agentStatuses = ['active', 'probation', 'paused'] as const;
export type AgentStatus = (typeof agentStatuses)[number];

export const trustLevels = ['approve_all', 'approve_important', 'autonomous'] as const;
export type TrustLevel = (typeof trustLevels)[number];

export const agentIconSchema = z.object({
  kind: z.enum(['glyph', 'emoji', 'image']),
  value: z.string(),
  bg: z.string().nullable(),
});
export type AgentIcon = z.infer<typeof agentIconSchema>;

export const agentSummarySchema = z.object({
  actionsWeek: z.number().int(),
  tasksActive: z.number().int(),
  tasksDone: z.number().int(),
  lastActionAt: z.string().nullable(),
  acceptedPct: z.number().nullable(),
});
export type AgentSummary = z.infer<typeof agentSummarySchema>;

export const agentConnectionSchema = z.object({
  connectionId: z.uuid(),
  providerKey: z.string(),
  name: z.string(),
  status: z.string(),
  accessLevel: z.enum(['read', 'read_write']),
  connectionAccessLevel: z.enum(['read', 'read_write']),
});

export const agentInstructionSchema = z.object({
  topic: z.string(),
  rule: z.string(),
});

export const projectAgentSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['manager', 'agent']),
  templateKey: z.string().nullable(),
  displayName: z.string(),
  roleText: z.string().nullable(),
  icon: agentIconSchema,
  status: z.enum(agentStatuses),
  probationUntil: z.string().nullable(),
  pausedUntil: z.string().nullable(),
  trustLevel: z.enum(trustLevels),
  instructions: z.array(agentInstructionSchema),
  limits: z.record(z.string(), z.union([z.number(), z.string()])),
  asks: z.array(z.string()),
  connections: z.array(agentConnectionSchema),
  hiredAt: z.string(),
  summary: agentSummarySchema,
});
export type ProjectAgent = z.infer<typeof projectAgentSchema>;

export const agentTemplateSummarySchema = z.object({
  key: z.string(),
  version: z.number().int(),
  category: z.string(),
  icon: z.string(),
  name: z.string(),
  role: z.string(),
  short: z.string(),
  description: z.string(),
  abilities: z.array(z.object({ name: z.string(), text: z.string() })),
  requirements: z.array(
    z.object({
      key: z.string(),
      required: z.boolean(),
      providers: z.array(z.string()),
      title: z.string(),
      purpose: z.string(),
    }),
  ),
  tools: z.array(z.string()),
});

export const agentNoteSchema = z.object({
  id: z.uuid(),
  text: z.string(),
  createdAt: z.string(),
});

export const projectAgentDetailsSchema = projectAgentSchema.extend({
  permissions: z.array(
    z.object({
      actionId: z.string(),
      risk: z.enum(['low', 'medium', 'high']).optional(),
      mode: z.enum(permissionModes),
      source: z.enum(['preset', 'explicit', 'system']),
      locked: z.boolean(),
    }),
  ),
  notes: z.array(agentNoteSchema),
  enforcedAsks: z.array(z.string()),
  template: agentTemplateSummarySchema.nullable(),
});

export const agentStatsSchema = z.object({
  brought: z.number().nullable(),
  metric: z
    .object({
      key: z.string(),
      title: z.string(),
      unit: z.string(),
    })
    .nullable(),
  costMonthRub: z.number(),
  aiMonthRub: z.number(),
  priceRub: z.number(),
  aiLimitRub: z.number().nullable(),
  acceptedPct: z.number().nullable(),
  decided: z.number().int(),
  actionsWeek: z.number().int(),
  streak: z.number().int(),
  streakTarget: z.number().int(),
  ideas: z.number().int(),
  ideasConfirmed: z.number().int(),
  checks: z.array(z.unknown()),
});
export type AgentStats = z.infer<typeof agentStatsSchema>;

export const agentActionTypes = ['tool', 'task', 'decision', 'insight', 'note', 'admin'] as const;
export type AgentActionType = (typeof agentActionTypes)[number];

export const agentActionItemSchema = z.object({
  id: z.string(),
  type: z.enum(agentActionTypes),
  at: z.string(),
  title: z.string(),
  details: z.string(),
  status: z.string(),
  targetId: z.string().nullable(),
  taskId: z.string().nullable(),
});
export type AgentActionItem = z.infer<typeof agentActionItemSchema>;

export const agentActionPageSchema = z.object({
  items: z.array(agentActionItemSchema),
  nextCursor: z.string().nullable(),
});
export type AgentActionPage = z.infer<typeof agentActionPageSchema>;

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
