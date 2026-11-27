import { z } from 'zod';

export const taskStatuses = ['planned', 'running', 'waiting', 'failed', 'done', 'cancelled'] as const;
export const taskStatusSchema = z.enum(taskStatuses);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskOrigins = ['owner', 'manager', 'agent', 'routine', 'check'] as const;
export type TaskOrigin = (typeof taskOrigins)[number];

export const waitingReasons = ['decision', 'subtasks', 'connection'] as const;
export type WaitingReason = (typeof waitingReasons)[number];

export const stepStatuses = ['todo', 'current', 'done', 'failed'] as const;
export type StepStatus = (typeof stepStatuses)[number];

export const taskTabSchema = z.enum(['active', 'done']);
export type TaskTab = z.infer<typeof taskTabSchema>;

export const taskStepSchema = z.object({
  position: z.number().int(),
  title: z.string(),
  status: z.enum(stepStatuses),
  at: z.string().nullable(),
  note: z.string().nullable(),
});
export type TaskStep = z.infer<typeof taskStepSchema>;

export const taskFactSchema = z.object({
  label: z.string(),
  value: z.string(),
});

export const taskErrorSchema = z.object({
  code: z.string(),
  what: z.string(),
  fix: z.string().nullable(),
});

export const taskResponseSchema = z.object({
  id: z.uuid(),
  agentId: z.uuid(),
  parentTaskId: z.uuid().nullable(),
  assignedByAgentId: z.uuid().nullable(),
  waitingReason: z.enum(waitingReasons).nullable(),
  title: z.string(),
  summary: z.string().nullable(),
  description: z.string().nullable(),
  status: taskStatusSchema,
  progressText: z.string().nullable(),
  progressPct: z.number().nullable(),
  scheduledAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  origin: z.enum(taskOrigins),
  mode: z.enum(['approve_all', 'approve_important', 'recommend_only']).nullable(),
  routineId: z.uuid().nullable(),
  conversationId: z.uuid().nullable(),
  result: z.string().nullable(),
  facts: z.array(taskFactSchema),
  error: taskErrorSchema.nullable(),
  steps: z.array(taskStepSchema),
  decisionId: z.uuid().nullable(),
  createdAt: z.string(),
});
export type ProjectTask = z.infer<typeof taskResponseSchema>;

export const createTaskSchema = z.object({
  agentId: z.uuid(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  mode: z.enum(['approve_all', 'approve_important', 'recommend_only']).optional(),
});
export type CreateProjectTask = z.infer<typeof createTaskSchema>;

export const taskCountsSchema = z.object({
  active: z.number().int(),
  routines: z.number().int(),
  done: z.number().int(),
});
export type TaskCounts = z.infer<typeof taskCountsSchema>;
