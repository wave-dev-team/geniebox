import { z } from 'zod';

import { taskStatusSchema } from './tasks.js';

export const scheduleKeys = [
  'every_5m',
  'hourly',
  'daily_09',
  'daily_18',
  'daily_21',
  'weekly_mon_10',
  'continuous',
] as const;
export const scheduleKeySchema = z.enum(scheduleKeys);
export type ScheduleKey = z.infer<typeof scheduleKeySchema>;

export const routineRunSchema = z.object({
  taskId: z.uuid(),
  status: taskStatusSchema,
  at: z.string(),
  result: z.string().nullable(),
});

export const routineSchema = z.object({
  id: z.uuid(),
  agentId: z.uuid(),
  assignedByAgentId: z.uuid().nullable(),
  kind: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  schedule: scheduleKeySchema,
  enabled: z.boolean(),
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  lastRunSummary: z.string().nullable(),
  recentRuns: z.array(routineRunSchema),
});
export type ProjectRoutine = z.infer<typeof routineSchema>;

export const createRoutineSchema = z.object({
  agentId: z.uuid(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  schedule: scheduleKeySchema,
});
export type CreateProjectRoutine = z.infer<typeof createRoutineSchema>;

export const updateRoutineSchema = z.object({
  enabled: z.boolean().optional(),
  schedule: scheduleKeySchema.optional(),
});
export type UpdateProjectRoutine = z.infer<typeof updateRoutineSchema>;
