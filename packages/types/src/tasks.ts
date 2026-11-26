import { z } from 'zod';

const nonNullCharacter = (value: string) => !value.includes('\u0000');
export const taskFieldsSchema = z.object({
  title: z.string().trim().min(1).max(160).refine(nonNullCharacter),
  description: z.string().trim().max(4000).refine(nonNullCharacter),
  dueOn: z.iso.date().nullable(),
});

export const createWorkTaskSchema = taskFieldsSchema.strict().extend({
  id: z.uuid(),
  agentId: z.uuid().nullable(),
});

export const updateWorkTaskSchema = taskFieldsSchema
  .strict()
  .partial()
  .refine((value) => Object.keys(value).length > 0);

export const taskActionSchema = z.enum(['start', 'complete', 'cancel', 'retry']);
export const taskTabSchema = z.enum(['active', 'done']);
export const taskStatusSchema = z.enum(['planned', 'running', 'failed', 'done', 'cancelled']);

export const workTaskSchema = z.object({
  ...taskFieldsSchema.shape,
  title: z.string(),
  description: z.string(),
  id: z.uuid(),
  agentId: z.uuid().nullable(),
  agentName: z.string().nullable(),
  status: taskStatusSchema,
  result: z.string().nullable(),
  turnId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const taskPageSchema = z.object({
  tasks: z.array(workTaskSchema),
  nextCursor: z.uuid().nullable(),
});

export const taskCountsSchema = z.object({ active: z.number().int(), done: z.number().int() });

export type WorkTask = z.infer<typeof workTaskSchema>;
export type TaskTab = z.infer<typeof taskTabSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskAction = z.infer<typeof taskActionSchema>;
export type CreateWorkTask = z.infer<typeof createWorkTaskSchema>;
export type UpdateWorkTask = z.infer<typeof updateWorkTaskSchema>;
