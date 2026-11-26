import { z } from 'zod';

import { taskFieldsSchema } from './tasks.js';

export const routineCadenceSchema = z.enum(['daily', 'weekly']);
export const createRoutineSchema = taskFieldsSchema
  .pick({ title: true, description: true })
  .strict()
  .extend({ id: z.uuid(), cadence: routineCadenceSchema });

export const routineSchema = createRoutineSchema.extend({
  enabled: z.boolean(),
  nextRunAt: z.iso.datetime(),
});

export const routinesSchema = routineSchema.array();

export type CreateRoutine = z.infer<typeof createRoutineSchema>;
